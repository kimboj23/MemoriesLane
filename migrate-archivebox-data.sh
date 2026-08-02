#!/usr/bin/env bash
# One-time migration of the standalone ArchiveBox instance's data
# (~/archivebox/data, local-disk only, index.sqlite3 + archive/ content) into
# this repo's S3-backed setup (docker-compose.vps.yml).
#
# Safe to run while the old container is still up — everything here is
# read-only against the old data dir, and additive against the new volume/S3
# bucket (uses `rclone copy`, never `sync`, so nothing gets deleted). It does
# NOT stop the old container or start the new stack — that's the cutover step,
# done separately (see bottom of this file's output) so you can verify the
# migrated data first.
#
# Run this FROM the repo root on the VPS (e.g. ~/MemoriesLane), after
# archivebox/rclone.env and backend/.env have been copied over.
#
# Usage:
#   chmod +x migrate-archivebox-data.sh
#   OLD_DATA_DIR=~/archivebox/data ./migrate-archivebox-data.sh   # OLD_DATA_DIR defaults to this

set -euo pipefail

OLD_DATA_DIR="${OLD_DATA_DIR:-$HOME/archivebox/data}"
NEW_VOLUME="memorylane-archivebox-data"
RCLONE_ENV="archivebox/rclone.env"

step() { printf '\n\033[1;36m== %s ==\033[0m\n' "$1"; }

# ---------------------------------------------------------------------------
step "1. Sanity checks"
# ---------------------------------------------------------------------------
[ -d "$OLD_DATA_DIR" ] || { echo "OLD_DATA_DIR ($OLD_DATA_DIR) not found." >&2; exit 1; }
[ -f "$OLD_DATA_DIR/index.sqlite3" ] || { echo "$OLD_DATA_DIR/index.sqlite3 not found — is OLD_DATA_DIR right?" >&2; exit 1; }
[ -f "$RCLONE_ENV" ] || { echo "$RCLONE_ENV not found — copy it from your laptop first." >&2; exit 1; }

# S3_BUCKET is not a secret (it's a bucket name); read it without echoing the
# RCLONE_CONFIG_SB_* secrets that live in the same file.
S3_BUCKET="$(grep -E '^S3_BUCKET=' "$RCLONE_ENV" | head -1 | cut -d= -f2-)"
S3_BUCKET="${S3_BUCKET:-memory-archive}"
ARCHIVE_REMOTE="sb:${S3_BUCKET}/archivebox"
echo "Old data dir : $OLD_DATA_DIR"
echo "S3 bucket    : $S3_BUCKET (remote path: $ARCHIVE_REMOTE)"
echo "New volume   : $NEW_VOLUME"

# ---------------------------------------------------------------------------
step "2. Backup (tar) — always, before touching anything"
# ---------------------------------------------------------------------------
BACKUP="$HOME/archivebox-data-backup-$(date +%Y%m%d-%H%M%S).tar.gz"
tar czf "$BACKUP" -C "$(dirname "$OLD_DATA_DIR")" "$(basename "$OLD_DATA_DIR")"
echo "Backed up to $BACKUP ($(du -h "$BACKUP" | cut -f1))"

# ---------------------------------------------------------------------------
step "3. Upload archive/ content to Supabase S3 (additive, via rclone copy)"
# ---------------------------------------------------------------------------
if [ -d "$OLD_DATA_DIR/archive" ] && [ -n "$(ls -A "$OLD_DATA_DIR/archive" 2>/dev/null)" ]; then
  # Don't let one bad object key (Supabase's S3 API rejects some characters,
  # e.g. ';'/'@'/'=' from a Google-Fonts-style query string ArchiveBox saved
  # literally into a filename) abort the whole migration — rclone already
  # continues past per-file errors and re-running is safe/idempotent (already
  # -uploaded files are skipped), so just surface the failure and carry on.
  set +e
  docker run --rm \
    --env-file "$RCLONE_ENV" \
    -v "$OLD_DATA_DIR/archive:/src:ro" \
    rclone/rclone:latest \
    copy /src "$ARCHIVE_REMOTE" --checkers 4 --transfers 4 -v
  RCLONE_STATUS=$?
  set -e
  if [ "$RCLONE_STATUS" -ne 0 ]; then
    echo "WARNING: rclone reported errors (exit $RCLONE_STATUS) uploading to" >&2
    echo "$ARCHIVE_REMOTE — check the log above for which object(s) failed and" >&2
    echo "why. Continuing with the rest of the migration regardless." >&2
  fi
  echo "Verifying upload:"
  docker run --rm --env-file "$RCLONE_ENV" rclone/rclone:latest \
    size "$ARCHIVE_REMOTE"
else
  echo "No content in $OLD_DATA_DIR/archive — nothing to upload."
fi

# ---------------------------------------------------------------------------
step "4. Copy index.sqlite3 / ArchiveBox.conf / sources / logs into $NEW_VOLUME"
# ---------------------------------------------------------------------------
docker volume create "$NEW_VOLUME" >/dev/null
docker run --rm \
  -v "$OLD_DATA_DIR:/src:ro" \
  -v "$NEW_VOLUME:/dest" \
  alpine sh -c '
    set -e
    cp -a /src/index.sqlite3 /dest/
    [ -f /src/ArchiveBox.conf ] && cp -a /src/ArchiveBox.conf /dest/ || true
    [ -d /src/sources ] && cp -a /src/sources /dest/ || true
    [ -d /src/logs ] && cp -a /src/logs /dest/ || true
    echo "Volume now contains:"
    ls -la /dest
  '

cat <<EOF

Migration done. The old container at ~/archivebox is still running and
untouched — nothing has been cut over yet. Next steps, when you're ready:

  1. Stop the old container (brief downtime for archivebox.heomay.xyz):
       cd ~/archivebox && docker compose down

  2. Start the new stack, which will reuse the same archivebox.heomay.xyz
     ingress rule (still points at localhost:8000) and set up
     archivebox-api.heomay.xyz for the backend:
       cd ~/MemoriesLane && TUNNEL=archivebox-vps ./deploy-vps.sh

  3. Confirm the migrated snapshots are visible (2 expected) via the
     ArchiveBox admin UI at https://archivebox.heomay.xyz, then set
     BACKEND_URL=https://archivebox-api.heomay.xyz in the Cloudflare Pages
     dashboard and redeploy.
EOF

#!/bin/bash
# Nightly off-box backup of the ArchiveBox archive (VPS-side; cron, see README
# "Backups"). Runs on the VPS as the debian user.
#
# Since 2026-09-17 the archive's primary copy is /data/archive on the
# archivebox-data docker volume -- i.e. this VPS's disk (it was a Supabase S3
# FUSE mount before). That makes this script load-bearing: without it, a disk
# failure or a hostile `rm` on the VPS is the end of the archive.
#
# What it does, in order:
#   1. A WAL-consistent snapshot of index.sqlite3 (a plain `cp` of a live
#      SQLite DB can be torn), plus ArchiveBox.conf (holds SECRET_KEY) and the
#      auto-archiver's orchestration.yaml, into ~/backups/archivebox on the
#      host. 30-day retention there.
#   2. rclone COPY (never sync) of /data/archive and those index snapshots to
#      Backblaze B2. Copy, not sync, so nothing this VPS does can remove a
#      file from B2 -- pair it with an application key that lacks
#      deleteFiles and a bucket created with Object Lock, and even a fully
#      compromised VPS cannot destroy the off-box copy. Snapshots deleted in
#      ArchiveBox therefore linger in B2; for an evidence archive that is the
#      right default.
#
# rclone isn't installed on the host; it runs from the official image with the
# volume mounted read-only. Credentials come from backup/b2.env (gitignored;
# template in b2.env.example) -- never from this file.
#
# --fast-list on every B2 listing is not an optimisation, it is a correctness
# requirement: B2 bills directory listings (Class C, 2,500/day free) and a
# wget mirror has hundreds of nested asset folders, so a per-directory walk
# of this archive burns the whole daily allowance in one pass. That happened
# on 2026-09-17 (two ad-hoc verification runs without it) and blocked the
# web console for the rest of the day. With --fast-list the archive lists in
# ~6 transactions.
set -euo pipefail

REPO="${MEMORIESLANE_DIR:-$HOME/MemoriesLane}"
ENV_FILE="${B2_ENV_FILE:-$REPO/backup/b2.env}"
LOCAL="${ARCHIVEBOX_BACKUP_DIR:-$HOME/backups/archivebox}"
CONTAINER="${ARCHIVEBOX_CONTAINER:-memorieslane-archivebox-1}"
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.68}"
STAMP="$(date +%F)"

log() { echo "[$(date -Is)] $*"; }

mkdir -p "$LOCAL"

# ---- 1. local, consistent index snapshot -----------------------------------
# Python's sqlite3 backup API is the same online-backup mechanism as the
# sqlite3 CLI's `.backup`, without needing the CLI in the image. The
# container's /data is the volume, so write the snapshot there and lift it out.
log "index snapshot"
# -i is required: without it docker exec does not forward stdin, python3 reads
# an empty script from `-`, exits 0, and the step silently does nothing.
docker exec -i --user=archivebox "$CONTAINER" python3 - <<'PY'
import sqlite3
src = sqlite3.connect('/data/index.sqlite3')
dst = sqlite3.connect('/data/index-backup.sqlite3')
with dst:
    src.backup(dst)
dst.close(); src.close()
PY
# Each copy on its own line so a failure is a failure (set -e), not masked.
docker run --rm -v memorylane-archivebox-data:/d:ro -v memorylane-autoarchiver-config:/c:ro -v "$LOCAL:/out" alpine sh -ec "
  cp /d/index-backup.sqlite3 /out/index-$STAMP.sqlite3
  cp /d/ArchiveBox.conf      /out/ArchiveBox-$STAMP.conf
  cp /c/orchestration.yaml   /out/orchestration-$STAMP.yaml
  chown $(id -u):$(id -g) /out/index-$STAMP.sqlite3 /out/ArchiveBox-$STAMP.conf /out/orchestration-$STAMP.yaml"
chmod 600 "$LOCAL"/*.sqlite3 "$LOCAL"/*.conf "$LOCAL"/*.yaml 2>/dev/null || true
find "$LOCAL" -name 'index-*.sqlite3' -mtime +30 -delete
find "$LOCAL" -name 'ArchiveBox-*.conf' -mtime +30 -delete
find "$LOCAL" -name 'orchestration-*.yaml' -mtime +30 -delete
log "local: $(ls "$LOCAL" | wc -l) files, newest index $(du -h "$LOCAL/index-$STAMP.sqlite3" | cut -f1)"

# ---- 1b. encrypted bundle of the host-only secrets --------------------------
# Everything a fresh VPS would need that is in neither git nor the archive:
# backend/.env, cookies.txt, the bootstrapped Chrome profile, rclone.env,
# b2.env, and cloudflared's tunnel credentials. Without this, a dead VPS means
# rotating every credential and regenerating the consent-cookie profile from
# scratch (see README "Cookie-consent banners in captures" -- hours).
#
# Encrypted with a passphrase that lives ONLY in backup/secrets.passphrase on
# this host (gitignored, 600) and in the maintainer's password manager. B2
# holds ciphertext only, so a B2 account compromise leaks nothing. Named by a
# content hash so an unchanged set is not re-uploaded (Object Lock would keep
# every nightly copy for 90 days otherwise). Read via docker so root-only and
# uid-911-only files are included regardless of who runs this.
#
# Restore: openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
#            -pass file:secrets.passphrase -in secrets-<hash>.tar.enc | tar xzf - -C /
#          (paths inside are absolute: /home/debian/MemoriesLane/..., /etc/cloudflared/...)
PASS_FILE="${SECRETS_PASSPHRASE_FILE:-$REPO/backup/secrets.passphrase}"
SECRET_PATHS=(
  "$REPO/backend/.env"
  "$REPO/archivebox/rclone.env"
  "$REPO/archivebox/cookies.txt"
  "$REPO/archivebox/chrome_profile"
  "$REPO/backup/b2.env"
  /etc/cloudflared
)
# Chrome's regenerable caches are ~310 MB of the ~320 MB profile and change on
# every capture; the state that matters (Cookies, IndexedDB, Local Storage,
# Preferences, Local State -- the consent-banner dismissals) is under 3 MB.
# Excluded from BOTH the hash and the tar, or the bundle would be re-uploaded
# nightly and Object Lock would hold 90 copies of Chrome's cache.
CHROME_CACHE_EXCLUDES=(
  '*/Cache/*' '*/Code Cache/*' '*/GPUCache/*' '*/ShaderCache/*' '*/GrShaderCache/*'
  '*/GraphiteDawnCache/*' '*/Service Worker/CacheStorage/*' '*/Service Worker/ScriptCache/*'
  '*/Safe Browsing/*' '*/component_crx_cache/*' '*/extensions_crx_cache/*' '*BrowserMetrics*' '*.pma'
)
if [ -f "$PASS_FILE" ]; then
  log "secrets bundle"
  mounts=(); paths=(); find_ex=(); tar_ex=()
  for p in "${SECRET_PATHS[@]}"; do
    [ -e "$p" ] || continue
    mounts+=(-v "$p:$p:ro"); paths+=("$p")
  done
  for x in "${CHROME_CACHE_EXCLUDES[@]}"; do find_ex+=(! -path "$x"); tar_ex+=(--exclude="$x"); done
  # Content hash first (independent of tar metadata), then the bundle itself.
  # NUL-separated throughout: profile filenames contain spaces ("Local State").
  HASH=$(docker run --rm "${mounts[@]}" alpine sh -c \
           'find "$@" | sort -z | xargs -0 -r sha256sum | sha256sum' \
           _ "${paths[@]}" -type f "${find_ex[@]}" -print0 | cut -c1-12)
  BUNDLE="$LOCAL/secrets-$HASH.tar.enc"
  if [ -f "$BUNDLE" ]; then
    log "secrets unchanged ($HASH)"
  else
    docker run --rm "${mounts[@]}" alpine tar czf - "${tar_ex[@]}" "${paths[@]}" \
      | openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$PASS_FILE" -out "$BUNDLE"
    chmod 600 "$BUNDLE"
    log "secrets bundle written: $(basename "$BUNDLE") ($(du -h "$BUNDLE" | cut -f1))"
  fi
  ls -t "$LOCAL"/secrets-*.tar.enc 2>/dev/null | tail -n +4 | xargs -r rm -f   # keep newest 3
else
  log "WARNING: $PASS_FILE missing -- host secrets (backend/.env, cookies, chrome profile) are NOT backed up."
  log "         Create it: openssl rand -base64 32 > $PASS_FILE && chmod 600 $PASS_FILE ; then store a copy in your password manager."
fi

# ---- 2. off-box: Backblaze B2 -----------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  log "WARNING: $ENV_FILE missing -- local snapshot taken, but NO off-box copy. See backup/b2.env.example."
  exit 2
fi
# shellcheck disable=SC1090
B2_BUCKET="$(grep -E '^B2_BUCKET=' "$ENV_FILE" | cut -d= -f2-)"
if [ -z "$B2_BUCKET" ] || grep -q REPLACE_ME "$ENV_FILE"; then
  log "WARNING: $ENV_FILE still has placeholders -- NO off-box copy."
  exit 2
fi

log "rclone copy archive -> b2:$B2_BUCKET/archive"
docker run --rm --env-file "$ENV_FILE" \
  -v memorylane-archivebox-data:/data:ro \
  "$RCLONE_IMAGE" copy /data/archive "b2:$B2_BUCKET/archive" \
  --transfers 8 --checkers 8 --fast-list --stats-one-line --stats 0 --log-level NOTICE

log "rclone copy index snapshots + secrets bundle -> b2:$B2_BUCKET/index"
docker run --rm --env-file "$ENV_FILE" \
  -v "$LOCAL:/local:ro" \
  "$RCLONE_IMAGE" copy /local "b2:$B2_BUCKET/index" \
  --transfers 4 --fast-list --stats-one-line --stats 0 --log-level NOTICE

log "done"

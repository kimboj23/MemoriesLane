#!/bin/bash
# Nightly off-box backup of the capture hub (capture/), to the SAME Backblaze B2 bucket and credentials as the
# ArchiveBox backup (backup/b2.env, B2-SETUP.md), under its own prefix capture/. VPS-side, as the debian user,
# from a systemd timer (backup/systemd/capture-backup.*).
#
#   1. pg_dump of the hub's database, gzipped and ENCRYPTED with the same passphrase as the secrets bundle
#      (backup/secrets.passphrase; B2 holds ciphertext only). Named by a content hash, so an unchanged
#      database is not re-uploaded (Object Lock would keep every nightly copy for 90 days).
#   2. An encrypted bundle of the hub's host-only secrets (deploy/demo env files and secrets/: feed keys,
#      admin token, canary list), also hash-named.
#   3. rclone COPY (never sync, never delete) of the artifact store to b2:<bucket>/capture/store, with
#      --immutable: the store is content-addressed and never modified, so a changed object is an error,
#      never an overwrite. With the bucket's Object Lock, a compromised VPS cannot destroy the off-box copy.
#   4. rclone copy of the dumps and bundles to b2:<bucket>/capture/index.
#
# --fast-list on every B2 listing: B2 bills listings (Class C, 2,500/day free) -- see archivebox-backup.sh.
#
# Restore:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -pass file:secrets.passphrase -in db-<...>.sql.gz.enc \
#     | gunzip | docker exec -i <hub-db> psql -U capture capture
#   rclone copy b2:<bucket>/capture/store <store volume>      (the files' names are their SHA-256)
set -euo pipefail

REPO="${MEMORIESLANE_DIR:-$HOME/MemoriesLane}"
DEPLOY="${CAPTURE_DEPLOY_DIR:-$HOME/memlane-demo/deploy/demo}"
ENV_FILE="${B2_ENV_FILE:-$REPO/backup/b2.env}"
PASS_FILE="${SECRETS_PASSPHRASE_FILE:-$REPO/backup/secrets.passphrase}"
LOCAL="${CAPTURE_BACKUP_DIR:-$HOME/backups/capture}"
DB_CONTAINER="${HUB_DB_CONTAINER:-memlane-demo-hub-db-1}"
STORE_VOLUME="${HUB_STORE_VOLUME:-memlane-demo_hub-store}"
RCLONE_IMAGE="${RCLONE_IMAGE:-rclone/rclone:1.68}"

log() { echo "[$(date -Is)] $*"; }

if [ ! -f "$PASS_FILE" ]; then
  log "ERROR: $PASS_FILE missing -- nothing is uploaded unencrypted. See archivebox-backup.sh for how to create it."
  exit 2
fi
mkdir -p "$LOCAL"
umask 077
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -pass "file:$PASS_FILE" -out "$1"; }

# ---- 1. database ------------------------------------------------------------------------------------------
log "database dump"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
docker exec "$DB_CONTAINER" pg_dump -U capture --no-owner capture | gzip -n > "$TMP"   # -n: no timestamp, so the hash is stable
HASH="$(sha256sum "$TMP" | cut -c1-12)"
if ls "$LOCAL"/db-*-"$HASH".sql.gz.enc >/dev/null 2>&1; then
  log "database unchanged ($HASH)"
else
  enc "$LOCAL/db-$(date +%F)-$HASH.sql.gz.enc" < "$TMP"
  log "database dump written ($HASH, $(du -h "$TMP" | cut -f1) compressed)"
fi
find "$LOCAL" -name 'db-*.sql.gz.enc' -mtime +30 -delete

# ---- 2. host-only secrets ---------------------------------------------------------------------------------
SECRET_PATHS=()
for p in "$DEPLOY/hub.env" "$DEPLOY/hsnq.env" "$DEPLOY/secrets"; do [ -e "$p" ] && SECRET_PATHS+=("$p"); done
if [ ${#SECRET_PATHS[@]} -gt 0 ]; then
  SHASH="$(find "${SECRET_PATHS[@]}" -type f -print0 | sort -z | xargs -0 sha256sum | sha256sum | cut -c1-12)"
  if [ -f "$LOCAL/secrets-$SHASH.tar.enc" ]; then
    log "secrets unchanged ($SHASH)"
  else
    tar czf - "${SECRET_PATHS[@]}" 2>/dev/null | enc "$LOCAL/secrets-$SHASH.tar.enc"
    log "secrets bundle written ($SHASH)"
  fi
  ls -t "$LOCAL"/secrets-*.tar.enc 2>/dev/null | tail -n +4 | xargs -r rm -f   # keep the newest 3 locally
fi

# ---- 3 and 4. off-box: Backblaze B2 -----------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ] || grep -q REPLACE_ME "$ENV_FILE"; then
  log "WARNING: $ENV_FILE missing or unfilled -- local backup only, NO off-box copy."
  exit 2
fi
B2_BUCKET="$(grep -E '^B2_BUCKET=' "$ENV_FILE" | cut -d= -f2-)"

log "rclone copy store -> b2:$B2_BUCKET/capture/store"
docker run --rm --env-file "$ENV_FILE" -v "$STORE_VOLUME:/store:ro" "$RCLONE_IMAGE" \
  copy /store "b2:$B2_BUCKET/capture/store" --immutable \
  --transfers 8 --checkers 8 --fast-list --stats-one-line --stats 0 --log-level NOTICE

log "rclone copy dumps + secrets -> b2:$B2_BUCKET/capture/index"
docker run --rm --env-file "$ENV_FILE" -v "$LOCAL:/local:ro" "$RCLONE_IMAGE" \
  copy /local "b2:$B2_BUCKET/capture/index" --transfers 4 --fast-list --stats-one-line --stats 0 --log-level NOTICE

log "done"

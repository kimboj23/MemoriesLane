#!/bin/bash
# Mount the Supabase S3 bucket as ArchiveBox's archive/ folder, then hand off to
# ArchiveBox's normal entrypoint (which drops to the archivebox user, uid 911).
# rclone reads its remote "sb" from RCLONE_CONFIG_SB_* env vars (see rclone.env).
set -e

ARCHIVE_REMOTE="sb:${S3_BUCKET:-memory-archive}/archivebox"
echo "[entrypoint] mounting ${ARCHIVE_REMOTE} -> /data/archive (Supabase S3)"
mkdir -p /data/archive
# The mountpoint must be empty; archive content lives in S3, so /data/archive in
# the volume is only ever the mountpoint. Clear any stale leftovers (rclone
# refuses to mount over a non-empty dir).
if ! mountpoint -q /data/archive 2>/dev/null; then
  find /data/archive -mindepth 1 -delete 2>/dev/null || true
fi

# Backgrounded (not --daemon, which times out under dumb-init). Survives the
# exec below as a child of the ArchiveBox process and keeps serving the mount.
rclone mount "${ARCHIVE_REMOTE}" /data/archive \
  --allow-other --uid 911 --gid 911 --umask 002 \
  --vfs-cache-mode full --vfs-write-back 2s --dir-cache-time 12h \
  --transfers 8 --checkers 4 --log-level NOTICE &

# Wait until the mount is responsive before starting ArchiveBox.
for i in $(seq 1 30); do
  if mountpoint -q /data/archive 2>/dev/null; then echo "[entrypoint] S3 archive mounted"; break; fi
  sleep 1
done
mountpoint -q /data/archive 2>/dev/null || echo "[entrypoint] WARNING: archive mount not ready — continuing"

exec /app/bin/docker_entrypoint.sh "$@"

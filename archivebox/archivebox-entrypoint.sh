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

# Clear Chrome's profile lock left over from a previous container.
#
# Chromium writes SingletonLock -> "<hostname>-<pid>" into the profile while
# running and removes it on a clean exit. Killing the container (any redeploy)
# never gives it that chance, and the replacement container has a DIFFERENT
# hostname, so Chromium sees a lock it can't attribute to itself, assumes the
# profile is open "on another computer", and refuses to start -- permanently,
# since nothing ever cleans it up.
#
# That silently broke EVERY Chrome-backed extractor (singlefile/pdf/screenshot/
# dom, and title+readability+htmltotext downstream of them) while the
# non-Chrome ones (wget/mercury/media/favicon/headers) kept succeeding, so
# captures looked like they were working and just produced no title, no
# screenshot and no singlefile.html. Diagnosed 2026-08-26 from a lock dated
# six days earlier: "The profile appears to be in use by another Chromium
# process (13194) on another computer (196f2995ae14)".
#
# Backgrounded captures (see README "Captures no longer block the HTTP
# request") widen the window a lot -- a capture now outlives its HTTP request,
# so any deploy can land mid-Chrome.
#
# Safe unconditionally here: this runs before ArchiveBox starts in a brand-new
# container, so no Chromium of ours can legitimately hold the profile yet.
CHROME_PROFILE="${CHROME_USER_DATA_DIR:-/data/chrome_profile}"
if [ -d "$CHROME_PROFILE" ]; then
  for lock in SingletonLock SingletonSocket SingletonCookie; do
    if [ -e "$CHROME_PROFILE/$lock" ] || [ -L "$CHROME_PROFILE/$lock" ]; then
      echo "[entrypoint] clearing stale Chrome $lock ($(readlink "$CHROME_PROFILE/$lock" 2>/dev/null || echo '?'))"
      rm -f "$CHROME_PROFILE/$lock"
    fi
  done
fi

exec /app/bin/docker_entrypoint.sh "$@"

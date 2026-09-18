#!/bin/bash
# Prepare ArchiveBox's archive/ folder, then hand off to ArchiveBox's normal
# entrypoint (which drops to the archivebox user, uid 911).
#
# ARCHIVE_STORAGE picks where the archive lives:
#
#   local  (default)  /data/archive is a plain directory on the archivebox-data
#                     docker volume -- the VPS's own disk. Backed up off-box
#                     nightly (README "Backups").
#   s3                Legacy: mount Supabase S3 over /data/archive with rclone
#                     FUSE. rclone reads its remote "sb" from RCLONE_CONFIG_SB_*
#                     env vars (rclone.env). Needs cap SYS_ADMIN + /dev/fuse in
#                     docker-compose. Kept for rollback during the migration
#                     window only.
#
# Why the archive moved to local disk (2026-09-17): the bucket was in Tokyo and
# its only client is this VPS in Frankfurt (~800ms RTT; readers come through
# Cloudflare either way). That round trip sat behind a large share of this
# project's operational pain -- per-file stat costs feeding the 524s, `du`
# timing out at 300s, the 12h dir-cache workaround -- and Supabase's free tier
# (1 GB) was exceeded by the archive alone. Local disk also lets the container
# drop SYS_ADMIN/fuse, and the VPS no longer needs S3 write credentials for the
# archive at all. Trade-off: the primary copy is on one VPS, so the off-box
# backup is not optional.
set -e

ARCHIVE_STORAGE="${ARCHIVE_STORAGE:-local}"
mkdir -p /data/archive

if [ "$ARCHIVE_STORAGE" = "s3" ]; then
  ARCHIVE_REMOTE="sb:${S3_BUCKET:-memory-archive}/archivebox"
  echo "[entrypoint] archive storage: s3 -- mounting ${ARCHIVE_REMOTE} -> /data/archive"

  if ! mountpoint -q /data/archive 2>/dev/null; then
    # rclone refuses to mount over a non-empty dir. Historically this cleared
    # stale leftovers (a few dirs ArchiveBox wrote while a mount wasn't ready).
    # But once the archive can legitimately live here (local mode), an
    # unconditional delete would silently wipe it the first time someone
    # starts the container with the wrong mode. So: clear a handful of
    # leftovers, refuse to touch anything that looks like a real archive.
    n=$(find /data/archive -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)
    if [ "$n" -gt 5 ]; then
      echo "[entrypoint] ERROR: ARCHIVE_STORAGE=s3 but /data/archive already holds $n entries."
      echo "[entrypoint]        Refusing to delete a populated local archive. Set ARCHIVE_STORAGE=local,"
      echo "[entrypoint]        or move /data/archive aside yourself if you really mean to mount over it."
      exit 1
    fi
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
else
  n=$(find /data/archive -mindepth 1 -maxdepth 1 2>/dev/null | wc -l)
  echo "[entrypoint] archive storage: local -- /data/archive on the archivebox-data volume ($n top-level entries)"
  # A fresh container can't inherit a mount, so this only fires if someone
  # bind-mounted something odd; fail loudly rather than write into it.
  if mountpoint -q /data/archive 2>/dev/null; then
    echo "[entrypoint] ERROR: ARCHIVE_STORAGE=local but /data/archive is a mountpoint"; exit 1
  fi
fi

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
SINGLEFILE_PROFILE="${SINGLEFILE_CHROME_USER_DATA_DIR:-/data/chrome_profile_singlefile}"

# SingleFile drives its OWN Chrome (via its node CLI) and, when pointed at the
# same profile as the other extractors, leaves it in a state that hangs the
# NEXT chromium launch. `pdf` runs immediately after singlefile, so it always
# took the hit -- every pdf capture failed from 2026-08-12 (when
# CHROME_USER_DATA_DIR was first set, putting them on one profile) until
# 2026-08-26. screenshot/dom run later and were unaffected, which is what made
# it look pdf-specific. Proven by disabling singlefile for one capture: pdf
# then succeeded in 1.1s.
#
# Giving singlefile its own copy fixes the collision while keeping the
# consent-banner cookies it needs. Seeded once from the real profile, ~100MB
# on the local volume (never on the S3 mount).
if [ -d "$CHROME_PROFILE" ] && [ ! -d "$SINGLEFILE_PROFILE" ]; then
  echo "[entrypoint] seeding singlefile Chrome profile -> $SINGLEFILE_PROFILE"
  cp -a "$CHROME_PROFILE" "$SINGLEFILE_PROFILE" 2>/dev/null || true
fi

for profile in "$CHROME_PROFILE" "$SINGLEFILE_PROFILE"; do
  [ -d "$profile" ] || continue
  for lock in SingletonLock SingletonSocket SingletonCookie; do
    if [ -e "$profile/$lock" ] || [ -L "$profile/$lock" ]; then
      echo "[entrypoint] clearing stale Chrome $lock in $profile ($(readlink "$profile/$lock" 2>/dev/null || echo '?'))"
      rm -f "$profile/$lock"
    fi
  done
done

exec /app/bin/docker_entrypoint.sh "$@"

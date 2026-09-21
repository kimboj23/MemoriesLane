#!/bin/sh
# Pull the archive from B2 on a loop and rebuild the front page.
#
# rclone COPY, never sync: a snapshot removed upstream stays here. This is a
# mirror of an evidence archive, not a cache -- the asymmetry is deliberate.
#
# B2 billing notes that matter for a mirror (see README):
#   * --fast-list on every call. Listing is billed per directory otherwise,
#     and a wget mirror has hundreds of nested asset dirs per snapshot.
#   * Each downloaded FILE is one Class B transaction (2,500/day free). The
#     first pull of a 5,000-file archive exceeds that; raise the Class B and
#     download-bandwidth caps on the B2 account before the first run, or the
#     first sync stalls until the next day and finishes then.
set -u

: "${B2_BUCKET:?B2_BUCKET is not set -- copy b2.env.example to b2.env and fill it in}"
INTERVAL="${SYNC_INTERVAL_SECONDS:-3600}"
DATA=/srv/data
# Optional rclone filter, e.g. SYNC_INCLUDE='/17896*/**' to mirror a subset
# (used for smoke tests; leave unset for a full mirror).
INCLUDE_ARGS=""
if [ -n "${SYNC_INCLUDE:-}" ]; then INCLUDE_ARGS="--include $SYNC_INCLUDE"; fi

mkdir -p "$DATA/archive"
log() { echo "[sync] $(date -u +%FT%TZ) $*"; }

while :; do
  log "rclone copy b2:$B2_BUCKET/archive -> $DATA/archive"
  # shellcheck disable=SC2086
  if rclone copy "b2:$B2_BUCKET/archive" "$DATA/archive" \
       --fast-list --transfers 8 --checkers 8 $INCLUDE_ARGS \
       --stats-one-line --stats 0 --log-level NOTICE; then
    log "copy ok: $(find "$DATA/archive" -mindepth 1 -maxdepth 1 -type d | wc -l) snapshot dirs"
  else
    log "copy FAILED (cap hit, key problem, or network) -- serving what we have; retry in ${INTERVAL}s"
  fi

  if python3 /app/build_index.py "$DATA" "$DATA/index.html"; then
    log "front page rebuilt"
  else
    log "front page build FAILED -- previous index.html left in place"
  fi

  sleep "$INTERVAL"
done

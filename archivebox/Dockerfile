# ArchiveBox + rclone — mounts Supabase Storage (S3) as the archive/ folder so
# snapshots are stored in the cloud, not on local disk. The index.sqlite3 stays
# on the local volume (small, fast); only the big archive/ content goes to S3.
FROM rclone/rclone:latest AS rclone
FROM denoland/deno:bin-2.6.3 AS deno

FROM archivebox/archivebox:latest
USER root

# rclone is a static binary — copy it in; add fuse3 so it can mount.
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
RUN apt-get update && apt-get install -y --no-install-recommends fuse3 \
    && rm -rf /var/lib/apt/lists/* \
    && (grep -q '^user_allow_other' /etc/fuse.conf 2>/dev/null || echo 'user_allow_other' >> /etc/fuse.conf)

# yt-dlp needs frequent updates to keep working against YouTube's changes --
# the version pinned in the base image (2026.03.17, confirmed via direct
# testing 2026-08-14) was stale enough to fail outright. Also needs a JS
# runtime (Deno) to execute YouTube's current signature-decoding JS --
# without one, yt-dlp warns extraction "has been deprecated" and formats go
# missing. yt-dlp checks Deno's version and silently treats too-old ones as
# "unsupported" (confirmed by testing: 2.1.4 failed this check even though it
# ran fine standalone) -- keep this reasonably current, don't just pin once
# and forget it, same as yt-dlp itself.
COPY --from=deno /deno /usr/local/bin/deno
RUN pip install --no-cache-dir --upgrade yt-dlp

COPY archivebox-entrypoint.sh /usr/local/bin/archivebox-entrypoint.sh
RUN chmod +x /usr/local/bin/archivebox-entrypoint.sh

# Patched archive.org extractor — the stock ArchiveBox 0.7.4 extractor submits
# via an unauthenticated legacy endpoint that started returning HTTP 498
# (blocked) for this project regardless of credentials; this rewrite uses the
# authenticated SPN2 job API instead. See archive_org.py's own docstring for
# the full story and what to check if ArchiveBox is ever upgraded.
COPY archive_org.py /app/archivebox/extractors/archive_org.py
RUN rm -f /app/archivebox/extractors/__pycache__/archive_org.*.pyc

# Mount S3 first, then hand off to ArchiveBox's normal entrypoint.
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/archivebox-entrypoint.sh"]

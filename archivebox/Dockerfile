# ArchiveBox + rclone — mounts Supabase Storage (S3) as the archive/ folder so
# snapshots are stored in the cloud, not on local disk. The index.sqlite3 stays
# on the local volume (small, fast); only the big archive/ content goes to S3.
FROM rclone/rclone:latest AS rclone

FROM archivebox/archivebox:latest
USER root

# rclone is a static binary — copy it in; add fuse3 so it can mount.
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone
RUN apt-get update && apt-get install -y --no-install-recommends fuse3 \
    && rm -rf /var/lib/apt/lists/* \
    && (grep -q '^user_allow_other' /etc/fuse.conf 2>/dev/null || echo 'user_allow_other' >> /etc/fuse.conf)

COPY archivebox-entrypoint.sh /usr/local/bin/archivebox-entrypoint.sh
RUN chmod +x /usr/local/bin/archivebox-entrypoint.sh

# Mount S3 first, then hand off to ArchiveBox's normal entrypoint.
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/archivebox-entrypoint.sh"]

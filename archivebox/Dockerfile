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

# Drop the `size` column from the Snapshot admin list -- SnapshotAdmin.size()
# (core/admin.py) runs a recursive directory-size walk (get_dir_size) over
# EVERY row's archive folder, which lives on the S3-backed FUSE mount. Each
# uncached stat pays the ~800ms Frankfurt<->Tokyo round trip (see README
# "VPS region vs. Supabase Storage region"), and its cache is both
# process-memory-only (LocMemCache, wiped on every container restart) and
# keyed to invalidate on every Snapshot.updated change -- so it goes cold
# constantly. With up to SNAPSHOTS_PER_PAGE rows each walking a
# multi-file/dozens-of-files folder, this reliably exceeds Cloudflare's ~100s
# edge timeout and 524s the whole admin for anyone loading the snapshot list
# -- confirmed live 2026-08-14 (journalctl showed repeated "Incoming request
# ended abruptly: context canceled" on /admin/core/snapshot/, the one page
# that does this; the bare /admin/ login redirect, which renders no rows,
# stayed fast). Fails loudly (breaks the build) if the exact list_display
# line ever changes upstream, rather than silently no-op'ing.
RUN grep -q "list_display = ('added', 'title_str', 'files', 'size', 'url_str')" /app/archivebox/core/admin.py \
    && sed -i "s/list_display = ('added', 'title_str', 'files', 'size', 'url_str')/list_display = ('added', 'title_str', 'files', 'url_str')/" /app/archivebox/core/admin.py \
    && grep -q "list_display = ('added', 'title_str', 'files', 'url_str')" /app/archivebox/core/admin.py

# User admin registered with bare `admin.ModelAdmin` (core/admin.py's
# `admin.site.register(get_user_model())`, no admin class argument) instead
# of Django's real `django.contrib.auth.admin.UserAdmin` -- every field,
# including `password`, rendered as a plain form input with no hashing
# awareness. Confirmed live TWICE (2026-08-17, `longtrinh` then `sana`):
# typing a real password into that field saved it as a literal, unhashed
# string, so the account then couldn't log in, with no error shown anywhere.
# Root cause: `admin.site = ArchiveBoxAdmin()` further down in the same file
# replaces Django's default admin site with a fresh, empty one -- dropping
# every registration `django.contrib.auth`'s own admin.py would normally
# have made against the *old* default site, including the real `UserAdmin`
# and `Group`. Checked upstream before patching this ourselves: `core/
# admin_users.py` on the unreleased 0.9.x branch (v0.9.35rc206, 2026-08-09 --
# there has been no stable release since 0.7.4) fixes the User half the same
# way, via a `CustomUserAdmin(UserAdmin)`; this backports that same fix
# rather than inventing a different one. `Group` registration is NOT an
# upstream backport, though -- checked the same 0.9.x file and ArchiveBox has
# never registered Group in its admin, on any release; added here only so
# this deployment has a Groups UI at all. Fails loudly if either exact line
# ever changes upstream, rather than silently no-op'ing.
RUN grep -q "from django.contrib.auth import get_user_model" /app/archivebox/core/admin.py \
    && sed -i "s/from django.contrib.auth import get_user_model/from django.contrib.auth import get_user_model\nfrom django.contrib.auth.admin import UserAdmin, GroupAdmin\nfrom django.contrib.auth.models import Group/" /app/archivebox/core/admin.py \
    && grep -q "from django.contrib.auth.admin import UserAdmin, GroupAdmin" /app/archivebox/core/admin.py \
    && grep -q "admin.site.register(get_user_model())" /app/archivebox/core/admin.py \
    && sed -i "s/admin.site.register(get_user_model())/admin.site.register(get_user_model(), UserAdmin)\nadmin.site.register(Group, GroupAdmin)/" /app/archivebox/core/admin.py \
    && grep -q "admin.site.register(get_user_model(), UserAdmin)" /app/archivebox/core/admin.py \
    && grep -q "admin.site.register(Group, GroupAdmin)" /app/archivebox/core/admin.py

# The Snapshot admin's "grid" view (`/admin/core/snapshot/grid/` -- the card
# layout with thumbnails, `SnapshotAdmin.grid_view`) has its own hand-written
# template (`templates/admin/snapshots_grid.html`) that renders `{{
# obj.archive_size | file_size }}` for every card -- completely bypassing
# `list_display` (it doesn't use Django's normal changelist columns at all),
# so the `size`-column patch above never touched it. Same root cause as that
# patch (`archive_size`'s recursive S3-mounted directory-size walk, ~800ms/
# file over the Frankfurt<->Tokyo round trip -- see README "VPS region vs.
# Supabase Storage region"), a third distinct code path hitting it, confirmed
# live 2026-08-17 (`cloudflared` logs: "context canceled" on
# .../admin/core/snapshot/grid/). Fails loudly if the exact line ever changes
# upstream, rather than silently no-op'ing.
RUN grep -qF '<span>🗄&nbsp; {{ obj.archive_size | file_size }}</span>' /app/archivebox/templates/admin/snapshots_grid.html \
    && sed -i '/<span>🗄&nbsp; {{ obj.archive_size | file_size }}<\/span>/d' /app/archivebox/templates/admin/snapshots_grid.html \
    && ! grep -qF 'obj.archive_size' /app/archivebox/templates/admin/snapshots_grid.html

# Patched archive.org extractor — the stock ArchiveBox 0.7.4 extractor submits
# via an unauthenticated legacy endpoint that started returning HTTP 498
# (blocked) for this project regardless of credentials; this rewrite uses the
# authenticated SPN2 job API instead. See archive_org.py's own docstring for
# the full story and what to check if ArchiveBox is ever upgraded.
COPY archive_org.py /app/archivebox/extractors/archive_org.py
RUN rm -f /app/archivebox/extractors/__pycache__/archive_org.*.pyc

# Mount S3 first, then hand off to ArchiveBox's normal entrypoint.
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/archivebox-entrypoint.sh"]

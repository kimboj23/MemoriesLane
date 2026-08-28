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

# Make every slow write non-blocking, so no request can outlive Cloudflare's
# ~100s edge timeout -- the root fix for this deployment's recurring 524s (see
# ml_background.py's header, and README "Adding/re-crawling a URL directly in
# ArchiveBox's own admin"). Two patch sites, both APPENDED rather than sed'd
# into the middle of the vendored files: appending runs after the target
# classes are fully defined, so each patch is a plain monkeypatch and doesn't
# have to rewrite upstream internals.
#   1. core/views.py's AddView.form_valid -- the main one. Backs /add/, which
#      serves both the admin's Add form and the browser extension.
#   2. core/admin.py's Snapshot bulk actions (Pull/Title/Re-Snapshot/Reset/
#      Delete), plus ArchiveBoxAdmin.add_view for completeness.
# Each is guarded on the exact upstream call sites it depends on and then
# ast.parse'd, so an upstream change breaks the build loudly rather than
# silently shipping a no-op or a syntactically broken module.
# Chrome profile-lock handling (see util_chromelock.py's header). Upstream's
# chrome_cleanup() only ever clears the lock from its hardcoded default
# profile dir, so it became a silent no-op the moment CHROME_USER_DATA_DIR was
# set -- which is why every `pdf` capture failed from 2026-08-12 onward and
# why one killed container could disable all Chrome extractors indefinitely.
# Appended so it rebinds chrome_args/chrome_cleanup after util.py defines
# them; the extractors import from util later, so they pick up these.
COPY util_chromelock.py /tmp/util_chromelock.py
RUN grep -qF "def chrome_cleanup():" /app/archivebox/util.py \
    && grep -qF "def chrome_args(**options)" /app/archivebox/util.py \
    && grep -qF '/home/archivebox/.config/chromium/SingletonLock' /app/archivebox/util.py \
    && cat /tmp/util_chromelock.py >> /app/archivebox/util.py \
    && rm /tmp/util_chromelock.py \
    && grep -qF "MEMORIESLANE_CHROME_PROFILE_LOCK" /app/archivebox/util.py \
    && python3 -c "import ast; ast.parse(open('/app/archivebox/util.py', encoding='utf-8').read())" \
    && rm -f /app/archivebox/__pycache__/util.*.pyc

# Point SingleFile at its OWN Chrome profile. It launches chromium itself via
# its node CLI, and sharing one profile with the other extractors left that
# profile in a state that hangs the next chromium launch -- `pdf` runs right
# after singlefile and so failed on EVERY capture from 2026-08-12 (when
# CHROME_USER_DATA_DIR was introduced) to 2026-08-26, while screenshot/dom,
# which run later, were fine. Confirmed by disabling singlefile for one
# capture: pdf then succeeded in 1.1s. chrome_args() merges its kwargs over
# CHROME_OPTIONS, so overriding the profile here is enough; the entrypoint
# seeds that profile from the real one so singlefile keeps its consent
# cookies. See archivebox-entrypoint.sh and README "PDF captures".
RUN grep -qF "browser_args = chrome_args(CHROME_TIMEOUT=0)" /app/archivebox/extractors/singlefile.py \
    && sed -i "s|browser_args = chrome_args(CHROME_TIMEOUT=0)|browser_args = chrome_args(CHROME_TIMEOUT=0, CHROME_USER_DATA_DIR=__import__('os').environ.get('SINGLEFILE_CHROME_USER_DATA_DIR', '/data/chrome_profile_singlefile'))|" /app/archivebox/extractors/singlefile.py \
    && grep -qF "SINGLEFILE_CHROME_USER_DATA_DIR" /app/archivebox/extractors/singlefile.py \
    && python3 -c "import ast; ast.parse(open('/app/archivebox/extractors/singlefile.py', encoding='utf-8').read())" \
    && rm -f /app/archivebox/extractors/__pycache__/singlefile.*.pyc

COPY ml_background.py /app/archivebox/core/ml_background.py

COPY views_nonblocking.py /tmp/views_nonblocking.py
RUN grep -qF "class AddView(UserPassesTestMixin, FormView):" /app/archivebox/core/views.py \
    && grep -qF "def form_valid(self, form):" /app/archivebox/core/views.py \
    && grep -qF 'input_kwargs.update({"extractors": extractors})' /app/archivebox/core/views.py \
    && grep -qF "class SnapshotView(View):" /app/archivebox/core/views.py \
    && grep -qF "does not exist in" /app/archivebox/core/views.py \
    && cat /tmp/views_nonblocking.py >> /app/archivebox/core/views.py \
    && rm /tmp/views_nonblocking.py \
    && grep -qF "MEMORIESLANE_NONBLOCKING_ADDVIEW" /app/archivebox/core/views.py \
    && python3 -c "import ast; ast.parse(open('/app/archivebox/core/views.py', encoding='utf-8').read())"

COPY admin_nonblocking.py /tmp/admin_nonblocking.py
RUN grep -qF "def add_view(self, request):" /app/archivebox/core/admin.py \
    && grep -qF "'update_titles', 'update_snapshots', 'resnapshot_snapshot', 'overwrite_snapshots', 'delete_snapshots'" /app/archivebox/core/admin.py \
    && grep -qF "admin.site.disable_action('delete_selected')" /app/archivebox/core/admin.py \
    && cat /tmp/admin_nonblocking.py >> /app/archivebox/core/admin.py \
    && rm /tmp/admin_nonblocking.py \
    && grep -qF "MEMORIESLANE_NONBLOCKING_ADMIN" /app/archivebox/core/admin.py \
    && python3 -c "import ast; ast.parse(open('/app/archivebox/core/admin.py', encoding='utf-8').read())"

RUN rm -f /app/archivebox/core/__pycache__/admin.*.pyc /app/archivebox/core/__pycache__/views.*.pyc

# Patched archive.org extractor — the stock ArchiveBox 0.7.4 extractor submits
# via an unauthenticated legacy endpoint that started returning HTTP 498
# (blocked) for this project regardless of credentials; this rewrite uses the
# authenticated SPN2 job API instead. See archive_org.py's own docstring for
# the full story and what to check if ArchiveBox is ever upgraded.
COPY archive_org.py /app/archivebox/extractors/archive_org.py
RUN rm -f /app/archivebox/extractors/__pycache__/archive_org.*.pyc

# Mount S3 first, then hand off to ArchiveBox's normal entrypoint.
ENTRYPOINT ["dumb-init", "--", "/usr/local/bin/archivebox-entrypoint.sh"]

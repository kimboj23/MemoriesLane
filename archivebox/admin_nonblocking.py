

# ============================================================================
# MEMORIESLANE_NONBLOCKING_ADMIN -- appended to core/admin.py at image build
# ============================================================================
# Root fix for Cloudflare error 524 on this deployment. ArchiveBox 0.7.4 runs
# captures SYNCHRONOUSLY inside the admin HTTP request: `add_view` (the Add
# form, and the browser extension, which POSTs to the same endpoint) plus the
# Snapshot changelist's Pull / Title / Re-Snapshot / Reset / Delete actions
# all block until every extractor finishes. With TIMEOUT=180 and ~12
# extractors, one capture routinely runs for MINUTES -- far past Cloudflare's
# fixed ~100s edge timeout, which is not raisable below an Enterprise plan.
# So those requests didn't just *sometimes* 524, they always did, even though
# the capture itself was succeeding server-side the whole time.
#
# Every previous 524 fix in this project addressed a *slow read* (see README:
# the `size` column, the grid template, keep-alive connection poisoning).
# This one addresses the remaining class -- slow *writes* -- by removing the
# blocking entirely rather than trying to make it fast enough, since no
# capture can ever be guaranteed to finish inside 100s.
#
# Threads rather than subprocesses: Django's dev server is already threaded,
# and ArchiveBox's own CLI (`docker exec ... archivebox add`, which
# archive-worker uses constantly) already writes to this same SQLite index
# concurrently with the running server -- so a background thread is no new
# concurrency risk. Each task closes its Django DB connection on the way out,
# so a long-lived server doesn't leak one sqlite handle per admin action.
#
# Tradeoff, deliberate: the admin no longer streams capture output into the
# page, because the response is sent before the work starts. Progress goes to
# the container log instead (`docker logs memorieslane-archivebox-1`), and the
# Snapshots list shows the result once it lands.
# NOTE: `add_view` below is NOT the main add path -- core/urls.py routes
# `/admin/core/snapshot/add/` to a RedirectView pointing at `/add/`, which is
# core/views.py's AddView (patched separately -- see views_nonblocking.py).
# It's patched here anyway so the endpoint can't block if reached directly.
from core.ml_background import run_in_background as _ml_background
from core.ml_background import QUEUED_MSG as _ML_QUEUED_MSG


def _ml_add_view(self, request):
    """Non-blocking replacement for ArchiveBoxAdmin.add_view."""
    if not request.user.is_authenticated:
        return redirect('/admin/login/?next={}'.format(request.path))

    request.current_app = self.name
    context = {
        **self.each_context(request),
        'title': 'Add URLs',
    }

    if request.method == 'GET':
        context['form'] = AddLinkForm()

    elif request.method == 'POST':
        form = AddLinkForm(request.POST)
        if form.is_valid():
            url = form.cleaned_data['url']
            depth = 0 if form.cleaned_data['depth'] == '0' else 1
            _ml_background(
                'add {}'.format(url),
                add,
                urls=url,
                depth=depth,
                update_all=False,
                out_dir=OUTPUT_DIR,
            )
            context.update({
                'stdout': '[+] Adding URL: {}\n\n{}'.format(url, _ML_QUEUED_MSG),
                'form': AddLinkForm(),
            })
        else:
            context['form'] = form

    return render(template_name='add.html', request=request, context=context)


ArchiveBoxAdmin.add_view = _ml_add_view


# --- Snapshot changelist bulk actions -------------------------------------
# Each one resolves its queryset EAGERLY on the request thread (cheap DB
# reads) and hands plain, DB-detached values to the background thread -- a
# lazy queryset would otherwise be evaluated on a connection the request
# thread has already finished with.

def _ml_update_snapshots(self, request, queryset):
    links = [snapshot.as_link() for snapshot in queryset]
    _ml_background('Pull {} snapshot(s)'.format(len(links)), archive_links, links, out_dir=OUTPUT_DIR)
    self.message_user(request, '{} snapshot(s). {}'.format(len(links), _ML_QUEUED_MSG))
_ml_update_snapshots.short_description = 'Pull'


def _ml_update_titles(self, request, queryset):
    links = [snapshot.as_link() for snapshot in queryset]
    _ml_background(
        'Title+favicon for {} snapshot(s)'.format(len(links)),
        archive_links, links, overwrite=True, methods=('title', 'favicon'), out_dir=OUTPUT_DIR,
    )
    self.message_user(request, '{} snapshot(s). {}'.format(len(links), _ML_QUEUED_MSG))
_ml_update_titles.short_description = '⬇️ Title'


def _ml_resnapshot_snapshot(self, request, queryset):
    targets = [(snapshot.url.split('#')[0], snapshot.tags_str()) for snapshot in queryset]

    def _resnapshot_all():
        for base_url, tags in targets:
            stamp = datetime.now(timezone.utc).isoformat('T', 'seconds')
            add('{}#{}'.format(base_url, stamp), tag=tags)

    _ml_background('Re-Snapshot {} snapshot(s)'.format(len(targets)), _resnapshot_all)
    self.message_user(request, '{} snapshot(s). {}'.format(len(targets), _ML_QUEUED_MSG))
_ml_resnapshot_snapshot.short_description = 'Re-Snapshot'


def _ml_overwrite_snapshots(self, request, queryset):
    links = [snapshot.as_link() for snapshot in queryset]
    _ml_background(
        'Reset (overwrite) {} snapshot(s)'.format(len(links)),
        archive_links, links, overwrite=True, out_dir=OUTPUT_DIR,
    )
    self.message_user(request, '{} snapshot(s). {}'.format(len(links), _ML_QUEUED_MSG))
_ml_overwrite_snapshots.short_description = 'Reset'


def _ml_delete_snapshots(self, request, queryset):
    # Deleting also touches the S3-backed mount (one rm per archived file),
    # so a bulk delete can outlive the edge timeout just like a capture can.
    pks = list(queryset.values_list('pk', flat=True))

    def _delete_all():
        remove(snapshots=Snapshot.objects.filter(pk__in=pks), yes=True, delete=True, out_dir=OUTPUT_DIR)

    _ml_background('Delete {} snapshot(s)'.format(len(pks)), _delete_all)
    self.message_user(request, '{} snapshot(s). {}'.format(len(pks), _ML_QUEUED_MSG))
_ml_delete_snapshots.short_description = 'Delete'


SnapshotAdmin.update_snapshots = _ml_update_snapshots
SnapshotAdmin.update_titles = _ml_update_titles
SnapshotAdmin.resnapshot_snapshot = _ml_resnapshot_snapshot
SnapshotAdmin.overwrite_snapshots = _ml_overwrite_snapshots
SnapshotAdmin.delete_snapshots = _ml_delete_snapshots

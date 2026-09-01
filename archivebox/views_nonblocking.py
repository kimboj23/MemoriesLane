

# ============================================================================
# MEMORIESLANE_NONBLOCKING_ADDVIEW -- appended to core/views.py at image build
# ============================================================================
# THE main Cloudflare-524 fix. `/add/` is the single busiest write path in this
# deployment: it backs both the admin's "Add" form and the ArchiveBox browser
# extension (which POSTs here too), and `/admin/core/snapshot/add/` is just a
# RedirectView pointing at it (core/urls.py). Stock `AddView.form_valid` calls
# `add(...)` inline and only returns once every extractor has finished, so the
# request reliably outlived Cloudflare's ~100s edge timeout and 524'd -- while
# the capture itself carried on and succeeded server-side, which is exactly
# what made it look intermittent/confusing.
#
# This keeps stock behaviour byte-for-byte (same form fields, same kwargs,
# same template, same re-rendered blank form) EXCEPT that `add()` runs on a
# background thread and the response goes out immediately. See
# core/ml_background.py for why threads, and README "Adding/re-crawling a URL
# directly in ArchiveBox's own admin".
#
# Deliberate tradeoff: the page can no longer show the capture's stdout, since
# the response is sent before the work starts. Progress goes to the container
# log instead, and the Snapshots list shows the result when it lands.
from core.ml_background import run_in_background as _ml_run_in_background
from core.ml_background import QUEUED_MSG as _ML_QUEUED_MSG


def _ml_addview_form_valid(self, form):
    # NOTE: re-adding an already-archived URL as a NEW snapshot is handled in
    # main.py's add() now (see main_resnapshot.py), so it applies to the CLI
    # and the admin's Re-Snapshot action too rather than only to this form.
    url = form.cleaned_data["url"]
    print(f'[+] Adding URL: {url}')
    parser = form.cleaned_data["parser"]
    tag = form.cleaned_data["tag"]
    depth = 0 if form.cleaned_data["depth"] == "0" else 1
    extractors = ','.join(form.cleaned_data["archive_methods"])
    input_kwargs = {
        "urls": url,
        "tag": tag,
        "depth": depth,
        "parser": parser,
        "update_all": False,
        "out_dir": OUTPUT_DIR,
    }
    if extractors:
        input_kwargs.update({"extractors": extractors})

    _ml_run_in_background('add {}'.format(url), add, **input_kwargs)

    context = self.get_context_data()
    context.update({
        "stdout": '[+] Adding URL: {}\n\n{}'.format(url, _ML_QUEUED_MSG),
        "form": AddLinkForm(),
    })
    return render(template_name=self.template_name, request=self.request, context=context)


AddView.form_valid = _ml_addview_form_valid


# ============================================================================
# MEMORIESLANE_SELFHEAL_SNAPSHOT_INDEX
# ============================================================================
_ml_orig_snapshot_get = SnapshotView.get


def _ml_snapshot_get(self, request, path):
    """Rebuild a snapshot's own index.html on demand if it has gone missing.

    A snapshot folder's `index.html` is NOT captured content -- ArchiveBox
    generates it itself (`write_link_details`, index/__init__.py) at the end
    of a capture, entirely from data already in the DB. So it can go missing
    while every archived artifact is still intact, and the snapshot then 404s
    with "exists in DB, but resource ... does not exist in snapshot dir yet".
    Two ways that happens here: a capture interrupted before that final write
    (captures run in the background now, so a redeploy mid-capture can do it),
    and an index rebuilt from folder contents via `archivebox init --force`,
    which restores the DB rows but not these pages -- that's what left 5
    snapshots broken on 2026-08-24 after the 0.9.x rollback.

    Regenerating is cheap and fully derived, so rather than scan every
    snapshot folder on a timer -- that S3-mounted walk is precisely what
    caused this project's 524 incidents (see README) -- rebuild lazily at the
    only moment it matters: when someone actually asks for a missing one.
    Costs nothing on the normal path, because it only runs after a 404.
    """
    response = _ml_orig_snapshot_get(self, request, path)
    if getattr(response, 'status_code', 200) != 404:
        return response

    # Only ever regenerate ArchiveBox's OWN page. Never fabricate a missing
    # capture artifact (screenshot.png, warc/, ...) -- that would misrepresent
    # what was actually archived, which for this project is the whole point.
    if not path.endswith('/index.html'):
        return response

    slug = path.split('/', 1)[0]
    try:
        snapshot = Snapshot.objects.get(Q(timestamp=slug) | Q(id__startswith=slug))
    except (Snapshot.DoesNotExist, Snapshot.MultipleObjectsReturned):
        return response

    import os

    from index import write_link_details

    try:
        if not os.path.isdir(snapshot.link_dir):
            # No archived data at all -- the stock error is the honest answer.
            return response
        write_link_details(snapshot.as_link(), out_dir=snapshot.link_dir, skip_sql_index=True)
        print(f'[+] regenerated missing index.html for snapshot {snapshot.timestamp}')
    except Exception as e:
        print(f'[!] could not regenerate index.html for {snapshot.timestamp}: {type(e).__name__}: {e}')
        return response

    # Retry exactly once; if it still 404s the stock error page is returned.
    return _ml_orig_snapshot_get(self, request, path)


SnapshotView.get = _ml_snapshot_get

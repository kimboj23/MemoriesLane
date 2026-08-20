__package__ = 'archivebox.core'

"""
Shared background-task helper for this deployment's non-blocking patches
(MemoriesLane). Copied in at image build as core/ml_background.py and used by
both patch sites:

  - core/views.py's AddView.form_valid  (the /add/ form AND the browser
    extension, which POSTs to the same endpoint)
  - core/admin.py's Snapshot bulk actions (Pull / Title / Re-Snapshot /
    Reset / Delete)

Why this exists: ArchiveBox 0.7.4 runs captures SYNCHRONOUSLY inside the HTTP
request. With TIMEOUT=180 and ~12 extractors, one capture routinely runs for
minutes -- far past Cloudflare's fixed ~100s edge timeout, which is not
raisable below an Enterprise plan. Those requests didn't just sometimes 524,
they always did, even though the capture itself succeeded server-side.

Every earlier 524 fix in this project made a slow *read* fast (see README: the
`size` column, the grid template, keep-alive connection poisoning). This one
handles slow *writes*, which can't be made fast enough -- no capture can be
guaranteed to finish inside 100s -- so it stops blocking the response instead.

Threads rather than subprocesses: Django's dev server is already threaded, and
ArchiveBox's own CLI (`docker exec ... archivebox add`, which archive-worker
uses constantly) already writes to this same SQLite index concurrently with
the running server -- so a background thread adds no new concurrency risk.
"""

import threading

from django.db import connections

QUEUED_MSG = (
    'Started in the background. This page returned immediately instead of '
    'holding the connection open past Cloudflare’s ~100s limit (error 524). '
    'Refresh the Snapshots list in a minute or two to see the result, or watch '
    'progress with: docker logs -f memorieslane-archivebox-1'
)


def run_in_background(label, fn, *args, **kwargs):
    """Run a slow capture/delete off the request thread so the HTTP response
    can return immediately. Never lets an exception escape -- a failed
    background task must not take a server thread down with it."""

    def _run():
        try:
            fn(*args, **kwargs)
            print('[√] (background) {} finished'.format(label))
        except Exception as e:
            print('[X] (background) {} failed: {}: {}'.format(label, type(e).__name__, e))
        finally:
            # Django opens a fresh DB connection per thread; close it here
            # rather than leaking one per admin action on a long-lived server.
            connections.close_all()

    print('[+] (background) {} started'.format(label))
    threading.Thread(target=_run, name='ml-bg', daemon=True).start()

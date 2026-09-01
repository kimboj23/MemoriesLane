

# ============================================================================
# MEMORIESLANE_CLI_RESNAPSHOT -- appended to main.py at image build
# ============================================================================
# Make "re-adding an archived URL saves a NEW snapshot" apply to EVERY entry
# point, not just the web form.
#
# This behaviour started life in core/views.py's AddView (see
# views_nonblocking.py), which covers /add/ -- the admin form and the browser
# extension. The CLI never got it, so `archivebox add <already-archived-url>`
# silently reported "Found 0 new URLs not already in index" and did nothing.
# Two entry points quietly disagreeing is a trap: during the 2026-08-26 pdf
# investigation it produced two "verification captures" that never ran, whose
# two-week-old ArchiveResult rows read exactly like fresh failures and sent
# the debugging down a wrong path twice.
#
# Wrapping main.add() fixes both paths at once, since AddView, the CLI and
# the admin's Re-Snapshot action all funnel through it -- so there is one
# rule about what a re-add does, wherever it comes from.
#
# Same two limits as before: only URLs ALREADY in the index get a fragment
# (a first capture keeps its clean canonical URL, which archive-worker's
# `list --filter-type=exact` lookups depend on), and only bare http(s) lines
# are rewritten (the input may be a multi-URL blob for another parser).
_ml_orig_add = add


def _ml_resnapshot_urls(urls):
    from datetime import datetime as _dt, timezone as _tz

    from core.models import Snapshot

    stamp = _dt.now(_tz.utc).isoformat('T', 'seconds')

    def rewrite(line):
        candidate = line.strip()
        if not (candidate.startswith('http://') or candidate.startswith('https://')):
            return line
        # Match the EXACT url, never the bare base. Matching the base meant a
        # URL the user deliberately supplied a fragment for
        # (https://site/page#section-2) got that fragment replaced by our
        # timestamp even on its FIRST capture -- silently archiving something
        # other than what was asked for. Caught 2026-08-28 when this ate a
        # test's own fragment. Only a genuine re-add of an identical URL now
        # gets rewritten, which is also what makes it a distinct Snapshot.
        if not Snapshot.objects.filter(url=candidate).exists():
            return line
        base = candidate.split('#')[0]
        print('[*] Already archived, saving as a NEW snapshot: {}'.format(base))
        return '{}#{}'.format(base, stamp)

    if isinstance(urls, str):
        return '\n'.join([rewrite(line) for line in urls.splitlines()])
    if isinstance(urls, (list, tuple)):
        return [rewrite(u) for u in urls]
    return urls


def add(urls, *args, **kwargs):
    return _ml_orig_add(_ml_resnapshot_urls(urls), *args, **kwargs)

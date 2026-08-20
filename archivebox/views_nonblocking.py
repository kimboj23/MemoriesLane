

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
from datetime import datetime as _ml_datetime
from datetime import timezone as _ml_timezone

from core.ml_background import run_in_background as _ml_run_in_background
from core.ml_background import QUEUED_MSG as _ML_QUEUED_MSG


def _ml_resnapshot_existing(raw_urls):
    """Let re-adding an already-archived URL save a NEW snapshot instead of
    silently doing nothing.

    ArchiveBox runs with ONLY_NEW=True, so `add()` skips any URL already in
    the index -- which meant re-adding from the Add form or the browser
    extension appeared to do nothing at all. The only way 0.7.4 keeps several
    snapshots of one URL is to make the URL string itself distinct, which is
    exactly what its own "Re-Snapshot" admin action does
    (`url.split('#')[0] + f'#{timestamp}'`). This applies that same trick at
    capture time so the plugin/Add form get the behaviour too -- see README
    "Saving multiple snapshots of a single URL".

    Only URLs ALREADY in the index get a fragment. A URL being archived for
    the first time is left exactly as typed, so the common case still stores a
    clean canonical URL -- which matters because archive-worker looks
    snapshots up with `list --filter-type=exact <url>`
    (worker/archivers/archivebox.js), and fragment-suffixing every capture
    would break those exact matches.

    Only bare http(s) lines are touched. The `url` field is a textarea that
    may hold several URLs, or a pasted blob some other parser handles, so
    anything that isn't plainly a URL is passed through untouched rather than
    risk corrupting it.
    """
    stamp = _ml_datetime.now(_ml_timezone.utc).isoformat('T', 'seconds')
    out = []
    for line in raw_urls.splitlines():
        candidate = line.strip()
        if candidate.startswith('http://') or candidate.startswith('https://'):
            base = candidate.split('#')[0]
            already_archived = Snapshot.objects.filter(
                Q(url=base) | Q(url__startswith=base + '#')
            ).exists()
            if already_archived:
                print(f'[*] Already archived, saving as a NEW snapshot: {base}')
                out.append(f'{base}#{stamp}')
                continue
        out.append(line)
    return '\n'.join(out)


def _ml_addview_form_valid(self, form):
    url = _ml_resnapshot_existing(form.cleaned_data["url"])
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

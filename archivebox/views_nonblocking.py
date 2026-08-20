

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

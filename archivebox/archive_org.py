__package__ = 'archivebox.extractors'

"""
Patched replacement for ArchiveBox 0.7.4's stock extractors/archive_org.py.

The stock version submits via a bare, unauthenticated `curl --head` to the
legacy `web.archive.org/save/<url>` endpoint. As of 2026-08-13 that endpoint
returns HTTP 498 for every request from this project's VPS -- confirmed by
direct testing, including WITH a correctly-formatted `Authorization: LOW
<access>:<secret>` header added, so this isn't an auth problem, the endpoint
itself appears to be blocked/deprecated. This rewrite instead speaks the
modern, authenticated SPN2 job API (POST /save, then poll
/save/status/<job_id>) -- the same flow this project's archive-worker used
successfully from worker/archivers/wayback.js before this patch, just ported
into ArchiveBox's own extractor so ArchiveBox remains the one thing that
submits to Wayback (see docker-compose.vps.yml's SAVE_ARCHIVE_DOT_ORG
comment for why).

Needs IA_ACCESS_KEY / IA_SECRET_KEY in the archivebox container's own
environment (https://archive.org/account/s3.php) -- added via
docker-compose.vps.yml's archivebox service pulling in backend/.env.

Drop-in replacement: same should_save_archive_dot_org/save_archive_dot_org
signatures the rest of ArchiveBox calls into (see extractors/__init__.py).
Deployed via a COPY in archivebox/Dockerfile overlaying this onto
/app/archivebox/extractors/archive_org.py -- if ArchiveBox is ever upgraded,
re-check this file against the new stock extractors/archive_org.py (imports,
ArchiveResult/ArchiveError shape, TimedProgress usage) before assuming it
still works.
"""

import os
import json
import time
import urllib.parse
from pathlib import Path
from typing import Optional
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

from ..index.schema import Link, ArchiveResult, ArchiveOutput, ArchiveError
from ..system import chmod_file
from ..util import (
    enforce_types,
    is_static_file,
)
from ..config import (
    TIMEOUT,
    SAVE_ARCHIVE_DOT_ORG,
)
from ..logging_util import TimedProgress

IA_ACCESS_KEY = os.environ.get('IA_ACCESS_KEY', '')
IA_SECRET_KEY = os.environ.get('IA_SECRET_KEY', '')


@enforce_types
def should_save_archive_dot_org(link: Link, out_dir: Optional[Path]=None, overwrite: Optional[bool]=False) -> bool:
    if is_static_file(link.url):
        return False

    out_dir = out_dir or Path(link.link_dir)
    if not overwrite and (out_dir / 'archive.org.txt').exists():
        return False

    return SAVE_ARCHIVE_DOT_ORG


def _spn_request(url: str, data: Optional[bytes], timeout: int) -> dict:
    # Deliberately NOT setting a browser-spoofing User-Agent here (unlike the
    # wget/curl/chrome extractors, which spoof one against the *target* VN
    # sites to avoid bot-blocking). Confirmed by direct testing: archive.org's
    # SPN2 API itself returns HTTP 498 for requests whose User-Agent looks
    # like a browser (e.g. CURL_USER_AGENT's "Mozilla/5.0 ... Chrome/118..."),
    # authenticated or not, and succeeds the moment that header is absent (or
    # presumably any honest, non-browser-looking value) -- the opposite
    # problem from the sites this project archives.
    headers = {
        'Accept': 'application/json',
        'Authorization': 'LOW {}:{}'.format(IA_ACCESS_KEY, IA_SECRET_KEY),
    }
    if data is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    req = Request(url, data=data, headers=headers, method='POST' if data is not None else 'GET')
    # Never let a raw urllib exception escape this function -- ArchiveBox
    # JSON-serializes ArchiveResult via dataclasses.asdict(), which deepcopies
    # every field, and HTTPError/URLError aren't deepcopy-safe (confirmed by
    # testing: "HTTPError.__init__() missing 5 required positional
    # arguments"), which crashes archivebox add entirely rather than just
    # failing this one extractor. ArchiveError is a plain exception, safe.
    try:
        with urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except HTTPError as e:
        body = ''
        try:
            body = e.read().decode('utf-8', 'replace')[:200]
        except Exception:
            pass
        raise ArchiveError('SPN HTTP {}: {}'.format(e.code, body or e.reason))
    except URLError as e:
        raise ArchiveError('SPN request failed: {}'.format(e.reason))
    except ValueError as e:
        raise ArchiveError('SPN response not valid JSON: {}'.format(e))


@enforce_types
def save_archive_dot_org(link: Link, out_dir: Optional[Path]=None, timeout: int=TIMEOUT) -> ArchiveResult:
    """submit site to archive.org for archiving via the authenticated SPN2 job
    API (submit + poll), save the returned archive url"""

    out_dir = out_dir or Path(link.link_dir)
    output: ArchiveOutput = 'archive.org.txt'
    archive_org_url = None
    status = 'succeeded'
    timer = TimedProgress(timeout, prefix='      ')
    try:
        if not (IA_ACCESS_KEY and IA_SECRET_KEY):
            raise ArchiveError('IA_ACCESS_KEY/IA_SECRET_KEY not set in the archivebox container environment')

        body = urllib.parse.urlencode({
            'url': link.url,
            'skip_first_archive': '1',
            'capture_all': '1',
        }).encode('utf-8')
        submit = _spn_request('https://web.archive.org/save', body, timeout)
        job_id = submit.get('job_id')
        if not job_id:
            raise ArchiveError('SPN: no job_id ({})'.format(json.dumps(submit)[:200]))

        # Poll until success/error or the extractor's own timeout budget runs
        # out (TimedProgress above interrupts this loop if it runs longer
        # than `timeout` -- same mechanism every other extractor in this
        # project already relies on, e.g. pdf/screenshot hitting TIMEOUT=180).
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(3)
            try:
                result = _spn_request('https://web.archive.org/save/status/{}'.format(job_id), None, timeout)
            except ArchiveError:
                continue  # transient poll failure -- keep trying until the deadline
            if result.get('status') == 'success':
                archive_org_url = 'https://web.archive.org/web/{}/{}'.format(
                    result.get('timestamp'), result.get('original_url', link.url)
                )
                break
            if result.get('status') == 'error':
                raise ArchiveError('SPN error: {}'.format(result.get('message') or result.get('status_ext') or 'unknown'))
            # status == "pending" -> keep polling

        if not archive_org_url:
            raise ArchiveError('SPN timed out waiting for snapshot')

    except Exception as err:
        status = 'failed'
        # Wrap whatever it is in a plain ArchiveError -- see the deepcopy note
        # in _spn_request above, applies to any exception type, not just
        # urllib's.
        output = err if isinstance(err, ArchiveError) else ArchiveError(str(err))
    finally:
        timer.end()

    if archive_org_url and status == 'succeeded':
        with open(str(out_dir / output), 'w', encoding='utf-8') as f:
            f.write(archive_org_url)
        chmod_file('archive.org.txt', cwd=str(out_dir))
        output = archive_org_url

    return ArchiveResult(
        cmd=['(python, not shell-runnable) SPN2 job submit + poll for', link.url],
        pwd=str(out_dir),
        cmd_version='spn2-authenticated',
        output=output,
        status=status,
        **timer.stats,
    )

"""The replay viewer: ReplayWeb.page on its own origin, for the WACZ of a capture (wacz.py).

    uvicorn memlane_capture.replay:app --host 0.0.0.0 --port 8701

Replay runs the captured page's own scripts, which the hub never does. So it lives on a separate origin that holds
nothing: no hub token, no cookies, no API. It serves only ReplayWeb.page (pinned, AGPL-3.0, unmodified, fetched at
image build) and, server to server, the one WACZ a signed artifact URL allows. Everything replayed comes from the
archive: the page's CSP lets the viewer reach only this origin, and ReplayWeb.page's service worker answers the
replayed page's requests from the archive, so opening a capture never contacts the platform.

The hub links here as  REPLAY_URL/#src=<artifact id>?exp=…&sig=…&url=<page>  (a fragment: never sent to a server).
"""

import os
import re

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse

from .config import settings

ASSETS = os.environ.get("REPLAY_ASSETS", "/opt/replaywebpage")
RWP_VERSION = os.environ.get("REPLAYWEBPAGE_VERSION", "2.5.3")
_ID = re.compile(r"^[0-9a-f-]{36}$")
_SIG = re.compile(r"^[A-Za-z0-9_.=-]{1,200}$")

app = FastAPI(title="MemoryLane replay", docs_url=None, redoc_url=None, openapi_url=None)

PAGE_CSP = ("default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: blob:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self'; "
            "frame-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'")

INDEX = f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MemoryLane · bản lưu tương tác</title>
<style>
 html,body{{margin:0;height:100%;font:14px system-ui,sans-serif;background:#f4f6f7;color:#15212b}}
 body{{display:flex;flex-direction:column}}
 header{{padding:8px 14px;border-bottom:1px solid #d3dce2;display:flex;gap:12px;flex-wrap:wrap;align-items:baseline}}
 header b{{font-weight:600}} header small{{color:#586874}}
 replay-web-page{{flex:1;min-height:0}}
 .err{{padding:24px}} a{{color:#1d6b86}}
 @media (prefers-color-scheme: dark){{html,body{{background:#0e151b;color:#e3eaef}} header{{border-color:#2a3843}} header small{{color:#96a6b3}} a{{color:#62b7d4}}}}
</style></head>
<body>
<header><b>Bản lưu tương tác</b><small>Phát lại từ tệp lưu trữ (WACZ) của lần lưu này; không kết nối tới nền tảng.
 Trình phát: <a href="https://github.com/webrecorder/replayweb.page" target="_blank" rel="noopener">ReplayWeb.page</a> {RWP_VERSION} (AGPL-3.0).</small></header>
<script src="/ui.js"></script>
<script src="/start.js"></script>
</body></html>"""

# The fragment carries the artifact and the page; nothing in it reaches a server log.
START = """
(function () {
  var p = new URLSearchParams(location.hash.slice(1));
  var src = p.get("src") || "", url = p.get("url") || "";
  var m = src.match(/^([0-9a-f-]{36})\\?(exp=[^&]+&sig=[^&]+)$/);
  if (!m) { document.body.insertAdjacentHTML("beforeend", "<p class='err'>Thiếu hoặc sai liên kết bản lưu.</p>"); return; }
  var el = document.createElement("replay-web-page");
  el.setAttribute("source", "/archive/" + m[1] + ".wacz?" + m[2]);
  el.setAttribute("replayBase", "/replay/");
  if (/^https?:\\/\\//.test(url)) el.setAttribute("url", url);
  el.setAttribute("embed", "default");
  document.body.appendChild(el);
})();
"""


# ReplayWeb.page's own app page: <replay-web-page> loads it in an iframe from replayBase (/replay/), and its
# service worker (/replay/sw.js) serves the replayed page under /replay/w/ from the archive.
APP = """<!doctype html>
<html class="no-overflow"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReplayWeb.page</title><script src="./ui.js"></script></head>
<body><replay-app-main></replay-app-main></body></html>"""


def _secure(resp):
    resp.headers.update({"X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
                         "Cross-Origin-Opener-Policy": "same-origin"})
    return resp


@app.get("/", include_in_schema=False)
async def index():
    r = HTMLResponse(INDEX)
    r.headers["Content-Security-Policy"] = PAGE_CSP
    r.headers["Cache-Control"] = "no-cache"
    return _secure(r)


@app.get("/replay/", include_in_schema=False)
async def replay_app():
    r = HTMLResponse(APP)
    r.headers["Content-Security-Policy"] = PAGE_CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'")
    r.headers["Cache-Control"] = "no-cache"
    return _secure(r)


@app.get("/start.js", include_in_schema=False)
async def start():
    return _secure(HTMLResponse(START, media_type="text/javascript"))


@app.get("/ui.js", include_in_schema=False)
@app.get("/replay/ui.js", include_in_schema=False)
@app.get("/replay/sw.js", include_in_schema=False)
async def asset(request: Request):
    path = os.path.join(ASSETS, os.path.basename(request.url.path))
    if not os.path.isfile(path):
        raise HTTPException(503, "the replay viewer's files are missing from this image")
    r = FileResponse(path, media_type="text/javascript")
    r.headers["Cache-Control"] = "public, max-age=86400"
    if request.url.path.endswith("/sw.js"):
        r.headers["Service-Worker-Allowed"] = "/replay/"
    return _secure(r)


@app.get("/archive/{artifact_id}.wacz", include_in_schema=False)
async def archive(artifact_id: str, exp: str, sig: str, request: Request):
    """The WACZ, fetched from the hub with the signed URL the hub issued (only to people who may read the item)."""
    if not _ID.match(artifact_id) or not _SIG.match(exp) or not _SIG.match(sig):
        raise HTTPException(404)
    headers = {"Range": request.headers["range"]} if "range" in request.headers else {}
    client = httpx.AsyncClient(timeout=60)
    req = client.build_request("GET", f"{settings.hub_internal_url}/v1/artifacts/{artifact_id}",
                               params={"exp": exp, "sig": sig}, headers=headers)
    up = await client.send(req, stream=True)
    if up.status_code not in (200, 206):
        await up.aclose()
        await client.aclose()
        raise HTTPException(404 if up.status_code in (401, 403, 404) else 502)
    keep = {k: up.headers[k] for k in ("content-length", "content-range", "accept-ranges") if k in up.headers}

    async def body():
        try:
            async for chunk in up.aiter_raw():
                yield chunk
        finally:
            await up.aclose()
            await client.aclose()
    r = StreamingResponse(body(), status_code=up.status_code, media_type="application/wacz", headers=keep)
    r.headers["Cache-Control"] = "private, max-age=3600"
    return _secure(r)

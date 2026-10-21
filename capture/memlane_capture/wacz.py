"""A replayable web archive (WACZ) of the visit the view witness already made: no second visit, no extra traffic.

Playwright records the browser context's HTTP traffic as a HAR (with bodies) while the witness works. This turns it
into a WARC (one request and one response record per exchange), indexes it (CDXJ), lists the pages, and packages
all of it as a WACZ (Webrecorder's format, https://specs.webrecorder.net/wacz/1.1.1/) that ReplayWeb.page replays.

What the WARC holds is the exchanges as the browser saw them (decoded bodies, its headers), reconstructed from the
HAR, not bytes off the wire; the warcinfo record says so. The proxy's credentials never appear: an HTTPS proxy is
authenticated on the CONNECT, which a HAR does not record.
"""

import base64
import datetime as dt
import hashlib
import io
import json
import os
import zipfile
from urllib.parse import urlsplit

from warcio.statusandheaders import StatusAndHeaders
from warcio.warcwriter import WARCWriter

WACZ_VERSION = "1.1.1"
# The body is stored decoded, so these would describe bytes that are no longer there.
_DROP = {"content-encoding", "transfer-encoding", "content-length", "connection", "keep-alive"}


def surt(url: str) -> str:
    """Sort-friendly URL key for the CDXJ index: com,example)/path?query (host reversed, no www, no scheme)."""
    u = urlsplit(url)
    host = (u.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    key = ",".join(reversed(host.split("."))) if host else ""
    if u.port and u.port not in (80, 443):
        key += f":{u.port}"
    return f"{key}){u.path or '/'}" + (f"?{u.query}" if u.query else "")


def _ts14(iso: str) -> str:
    try:
        t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        t = dt.datetime.now(dt.timezone.utc)
    return t.astimezone(dt.timezone.utc).strftime("%Y%m%d%H%M%S")


def _warc_date(iso: str) -> str:
    try:
        t = dt.datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        t = dt.datetime.now(dt.timezone.utc)
    return t.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _body(entry: dict, har_zip: zipfile.ZipFile) -> bytes:
    c = entry.get("response", {}).get("content", {}) or {}
    if c.get("_file"):
        try:
            return har_zip.read(c["_file"])
        except KeyError:
            return b""
    text = c.get("text")
    if text is None:
        return b""
    return base64.b64decode(text) if c.get("encoding") == "base64" else text.encode("utf-8")


def _headers(raw: list[dict], body_len: int | None = None) -> list[tuple[str, str]]:
    out = [(h["name"], h["value"]) for h in raw or [] if not h["name"].startswith(":")
           and h["name"].lower() not in _DROP]
    if body_len is not None:
        out.append(("Content-Length", str(body_len)))
    return out


def har_to_wacz(har_zip_path: str, out_path: str, *, pages: list[dict], software: str) -> dict:
    """Write `out_path` (a WACZ). `pages`: [{"url", "title"?}] in visit order. Returns counts and sizes."""
    with zipfile.ZipFile(har_zip_path) as hz:
        har = json.loads(hz.read(next(n for n in hz.namelist() if n.endswith(".har"))))
        entries = har.get("log", {}).get("entries", [])
        warc = io.BytesIO()
        writer = WARCWriter(warc, gzip=True)
        first_ts = entries[0]["startedDateTime"] if entries else dt.datetime.now(dt.timezone.utc).isoformat()
        info = writer.create_warcinfo_record("data.warc.gz", {
            "software": software, "format": "WARC File Format 1.1",
            "description": "Reconstructed from the browser's HTTP archive (HAR) of one MemoryLane capture: "
                           "bodies decoded, headers as the browser saw them."})
        writer.write_record(info)
        index: list[str] = []
        seen_pages = set()
        n = 0
        for e in entries:
            req, resp = e.get("request", {}), e.get("response", {})
            url = req.get("url", "")
            status = resp.get("status") or 0
            if not url.startswith(("http://", "https://")) or status <= 0:
                continue                               # data:, blob:, failed or aborted requests
            date = _warc_date(e.get("startedDateTime", first_ts))
            body = _body(e, hz)
            path = urlsplit(url).path or "/"
            if urlsplit(url).query:
                path += "?" + urlsplit(url).query
            req_body = ((req.get("postData") or {}).get("text") or "").encode("utf-8")
            rq = writer.create_warc_record(url, "request", payload=io.BytesIO(req_body), warc_headers_dict={"WARC-Date": date},
                                           http_headers=StatusAndHeaders(f"{req.get('method', 'GET')} {path} HTTP/1.1",
                                                                         _headers(req.get("headers"), len(req_body) if req_body else None),
                                                                         is_http_request=True))
            rs_headers = StatusAndHeaders(f"{status} {resp.get('statusText') or 'OK'}", _headers(resp.get("headers"), len(body)),
                                          protocol="HTTP/1.1")
            rs = writer.create_warc_record(url, "response", payload=io.BytesIO(body), http_headers=rs_headers,
                                           warc_headers_dict={"WARC-Date": date})
            offset = warc.tell()
            writer.write_record(rs)
            length = warc.tell() - offset
            writer.write_record(rq)
            mime = (resp.get("content", {}) or {}).get("mimeType", "").split(";")[0].strip()
            index.append(f"{surt(url)} {_ts14(e.get('startedDateTime', first_ts))} " + json.dumps(
                {"url": url, "mime": mime or "unk", "status": str(status),
                 "digest": rs.rec_headers.get_header("WARC-Payload-Digest"),
                 "length": str(length), "offset": str(offset), "filename": "data.warc.gz"}, separators=(",", ":")))
            n += 1
    index.sort()
    page_lines = [json.dumps({"format": "json-pages-1.0", "id": "pages", "title": "All Pages"})]
    for p in pages:
        if p.get("url") and p["url"] not in seen_pages:
            seen_pages.add(p["url"])
            page_lines.append(json.dumps({"id": hashlib.sha256(p["url"].encode()).hexdigest()[:16], "url": p["url"],
                                          "title": (p.get("title") or "")[:300], "ts": _warc_date(first_ts)}, ensure_ascii=False))
    files = {"archive/data.warc.gz": warc.getvalue(), "indexes/index.cdx": ("\n".join(index) + "\n").encode(),
             "pages/pages.jsonl": ("\n".join(page_lines) + "\n").encode("utf-8")}
    package = {"profile": "data-package", "wacz_version": WACZ_VERSION, "software": software,
               "created": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
               "mainPageURL": pages[0]["url"] if pages else None,
               "resources": [{"name": os.path.basename(k), "path": k, "hash": "sha256:" + hashlib.sha256(v).hexdigest(),
                              "bytes": len(v)} for k, v in files.items()]}
    files["datapackage.json"] = json.dumps(package, indent=2).encode()
    digest = {"path": "datapackage.json", "hash": "sha256:" + hashlib.sha256(files["datapackage.json"]).hexdigest()}
    files["datapackage-digest.json"] = json.dumps(digest).encode()
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_STORED) as z:   # the WARC is already gzipped
        for name, data in files.items():
            z.writestr(name, data)
    return {"records": n, "bytes": os.path.getsize(out_path), "pages": len(page_lines) - 1}

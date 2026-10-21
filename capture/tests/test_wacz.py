"""wacz.py: the browser's HAR becomes a WACZ whose index points at the right records (offline)."""

import base64
import gzip
import hashlib
import io
import json
import zipfile

from warcio.archiveiterator import ArchiveIterator

from memlane_capture.wacz import har_to_wacz, surt


def _har_zip(path, entries, attachments):
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("har.har", json.dumps({"log": {"version": "1.2", "entries": entries}}))
        for name, data in attachments.items():
            z.writestr(name, data)


def _entry(url, status, mime, *, file=None, text=None, b64=False, headers=None, method="GET", post=None):
    content = {"mimeType": mime}
    if file:
        content["_file"] = file
    if text is not None:
        content["text"] = text
        if b64:
            content["encoding"] = "base64"
    req = {"method": method, "url": url, "httpVersion": "HTTP/2.0", "headers": [{"name": ":authority", "value": "x"},
                                                                            {"name": "accept", "value": "*/*"}]}
    if post:
        req["postData"] = {"mimeType": "application/json", "text": post}
    return {"startedDateTime": "2026-10-21T08:00:00.000Z", "request": req,
            "response": {"status": status, "statusText": "", "httpVersion": "HTTP/2.0", "content": content,
                         "headers": headers or [{"name": "content-type", "value": mime},
                                                {"name": "content-encoding", "value": "br"},
                                                {"name": "content-length", "value": "3"}]}}


def test_surt():
    assert surt("https://www.Example.com/a/b?x=1") == "com,example)/a/b?x=1"
    assert surt("https://static.cdninstagram.com/") == "com,cdninstagram,static)/"
    assert surt("http://localhost:8799/x") == "localhost:8799)/x"


def test_har_to_wacz(tmp_path):
    html = "<html><body>Bài viết của user.b</body></html>".encode()
    png = b"\x89PNG\r\n\x1a\n" + bytes(range(64))
    har = tmp_path / "visit.har.zip"
    _har_zip(har, [
        _entry("https://www.threads.com/@user.b/post/PostCode001", 200, "text/html", file="a.html"),
        _entry("https://scontent.cdninstagram.com/v/p.png", 200, "image/png", text=base64.b64encode(png).decode(), b64=True),
        _entry("https://www.threads.com/api/graphql", 200, "application/json", text='{"ok":true}', method="POST", post='{"q":1}'),
        _entry("data:image/gif;base64,R0lGOD", 200, "image/gif", text="x"),          # not http: skipped
        _entry("https://www.threads.com/aborted", 0, "", text=""),                     # failed: skipped
    ], {"a.html": html})
    out = tmp_path / "visit.wacz"
    stats = har_to_wacz(str(har), str(out), pages=[{"url": "https://www.threads.com/@user.b/post/PostCode001", "title": "Post"},
                                                   {"url": "https://www.threads.com/@user.b/post/PostCode001/embed"}],
                        software="test")
    assert stats["records"] == 3 and stats["pages"] == 2

    z = zipfile.ZipFile(out)
    assert set(z.namelist()) == {"archive/data.warc.gz", "indexes/index.cdx", "pages/pages.jsonl",
                                 "datapackage.json", "datapackage-digest.json"}
    assert all(i.compress_type == zipfile.ZIP_STORED for i in z.infolist())
    pkg = json.loads(z.read("datapackage.json"))
    assert pkg["wacz_version"] == "1.1.1" and pkg["mainPageURL"].endswith("PostCode001")
    for r in pkg["resources"]:                                            # every file's hash is right
        assert r["hash"] == "sha256:" + hashlib.sha256(z.read(r["path"])).hexdigest()
    digest = json.loads(z.read("datapackage-digest.json"))
    assert digest["hash"] == "sha256:" + hashlib.sha256(z.read("datapackage.json")).hexdigest()

    warc = z.read("archive/data.warc.gz")
    lines = z.read("indexes/index.cdx").decode().strip().split("\n")
    assert lines == sorted(lines) and len(lines) == 3
    bodies = {"https://www.threads.com/@user.b/post/PostCode001": html, "https://scontent.cdninstagram.com/v/p.png": png,
              "https://www.threads.com/api/graphql": b'{"ok":true}'}
    for line in lines:                                                    # the index points at the right record
        key, ts, js = line.split(" ", 2)
        j = json.loads(js)
        assert ts == "20261021080000" and key == surt(j["url"])
        rec = next(iter(ArchiveIterator(io.BytesIO(warc[int(j["offset"]):int(j["offset"]) + int(j["length"])]))))
        assert rec.rec_type == "response" and rec.rec_headers.get_header("WARC-Target-URI") == j["url"]
        assert rec.content_stream().read() == bodies[j["url"]]
        h = dict((k.lower(), v) for k, v in rec.http_headers.headers)
        assert "content-encoding" not in h and h["content-length"] == str(len(bodies[j["url"]]))   # decoded body
    kinds = [r.rec_type for r in ArchiveIterator(io.BytesIO(warc))]
    assert kinds[0] == "warcinfo" and kinds.count("request") == 3
    assert gzip.decompress(warc)                                          # a valid multi-member gzip

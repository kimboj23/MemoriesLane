"""End-to-end: a public site forwards submissions (signed Intake API) -> triage in the UI -> public version with two
approvals -> the signed feed, verified like a public site would, and a withdrawal that removes it.

Same setup as the other e2e tests (E2E_BASE_URL + an admin E2E_TOKEN, inside the worker container). Needs
INTAKE_KEY_SECRET and the feed signing keys in capture/.env, and FEED_SERVE_LOCAL=true so /feed/ is served
by the API. Makes no external requests except capturing example.com.
"""

import hashlib
import io
import json
import os
import random
import secrets
import string
import time

import httpx
import pytest
from playwright.sync_api import expect, sync_playwright

from memlane_capture import feedkeys
from memlane_capture.intake import signature

BASE = os.environ.get("E2E_BASE_URL", "")
TOKEN = os.environ.get("E2E_TOKEN", "")
pytestmark = pytest.mark.skipif(not (BASE and TOKEN), reason="E2E_BASE_URL / E2E_TOKEN not set")


def api(method, path, body=None, token=TOKEN):
    r = httpx.request(method, BASE + path, json=body, headers={"Authorization": "Bearer " + token}, timeout=60)
    return r.status_code, (r.json() if r.headers.get("content-type", "").startswith("application/json") else r.content)


class Site:
    """What a public site's backend does (backend/lib/hub-client.js does the same in Node)."""

    def __init__(self, slug, key):
        self.slug, self.key = slug, key

    def call(self, method, path, body=b"", content_type=None, headers=None):
        ts, nonce = str(int(time.time())), secrets.token_urlsafe(18)
        h = {"X-ML-Source": self.slug, "X-ML-Timestamp": ts, "X-ML-Nonce": nonce,
             "X-ML-Signature": signature(self.key, ts, nonce, method, path, hashlib.sha256(body).hexdigest())}
        if content_type:
            h["Content-Type"] = content_type
        h.update(headers or {})
        return httpx.request(method, BASE + path, content=body, headers=h, timeout=60)

    def submit(self, envelope):
        return self.call("POST", "/intake/v1/submissions", json.dumps(envelope).encode(), "application/json")


def gps_jpeg() -> bytes:
    from PIL import Image
    im, ex = Image.new("RGB", (320, 240), (200, 60, 40)), Image.Exif()
    gps = ex.get_ifd(0x8825)
    gps[1], gps[2], gps[3], gps[4] = "N", (21.0, 1.0, 30.0), "E", (105.0, 51.0, 10.0)
    buf = io.BytesIO()
    im.save(buf, "JPEG", exif=ex)
    return buf.getvalue()


def load_feed(root_pub):
    keys = httpx.get(BASE + "/feed/keys.json").json()
    index = httpx.get(BASE + "/feed/index.json").content
    sig = httpx.get(BASE + "/feed/index.json.sig").json()
    assert feedkeys.check_delegation(keys["delegation"], root_pub, sig["online_public"], keys["revocations"]) is None
    assert feedkeys.verify(sig["online_public"], index, sig["signature"])
    idx = json.loads(index)
    recs = {}
    for e in idx["records"]:
        data = httpx.get(BASE + "/feed/" + e["path"]).content
        assert hashlib.sha256(data).hexdigest() == e["sha256"]
        recs[e["public_id"]] = json.loads(data)
    return recs, idx["tombstones"]


def wait_for(fn, timeout=90):
    end = time.time() + timeout
    while time.time() < end:
        v = fn()
        if v:
            return v
        time.sleep(2)
    raise AssertionError("timed out")


def test_intake_to_feed():
    s, cfg = api("GET", "/v1/admin/sources")
    if not cfg["configured"]:
        pytest.skip("INTAKE_KEY_SECRET not set")
    s, fs = api("GET", "/v1/feed/status")
    if not fs["configured"]:
        pytest.skip("feed signing keys not configured")
    tag = "".join(random.choices(string.ascii_uppercase, k=4))

    s, proj = api("POST", "/v1/projects", {"code": "N" + tag[:3], "name": f"Hồ sơ {tag}", "attributes": [
        {"name": "Nhóm hồ sơ", "type": "select", "options": ["Vi phạm", "Tố tụng", "Hạn chế mạng xã hội", "Phong trào xã hội"]}]})
    assert s == 201
    s, me = api("GET", "/v1/me")
    s, pubr = api("POST", "/v1/admin/contributors", {"name": f"Người công bố {tag}"})
    api("POST", f"/v1/projects/{proj['id']}/members", {"contributor_id": pubr["id"], "role": "editor"})
    assert api("PUT", f"/v1/projects/{proj['id']}/members/{pubr['id']}/publish", {"can_publish": True})[0] == 200
    s, src = api("POST", "/v1/admin/sources", {"slug": f"e2e-{tag.lower()}", "name": f"E2E site {tag}",
                                               "routing": {"memory": proj["id"], "case_report": proj["id"]}})
    assert s == 201
    site = Site(src["slug"], src["key"])

    # signatures: a replay and a wrong key are refused
    body = json.dumps({"external_id": f"r-{tag}", "kind": "link", "payload": {"url": "https://example.com/"}}).encode()
    ts, nonce = str(int(time.time())), secrets.token_urlsafe(18)
    hdr = {"X-ML-Source": site.slug, "X-ML-Timestamp": ts, "X-ML-Nonce": nonce, "Content-Type": "application/json",
           "X-ML-Signature": signature(site.key, ts, nonce, "POST", "/intake/v1/submissions", hashlib.sha256(body).hexdigest())}
    assert httpx.post(BASE + "/intake/v1/submissions", content=body, headers=hdr).status_code == 200
    assert httpx.post(BASE + "/intake/v1/submissions", content=body, headers=hdr).status_code == 409
    assert Site(site.slug, "0" * 64).submit({"external_id": "x", "kind": "link", "payload": {"url": "https://example.com/"}}).status_code == 401

    # a memory with a photo carrying GPS, and a case report with a link in its text
    jpg = gps_jpeg()
    receipt = hashlib.sha256(f"RCPT{tag}".encode()).hexdigest()
    r = site.submit({"external_id": f"m-{tag}", "kind": "memory", "receipt_sha256": receipt,
                     "files": [{"n": 1, "mime": "image/jpeg", "bytes": len(jpg)}],
                     "payload": {"text": "Ký ức kiểm tra.", "category": "community", "date": {"year": 2019, "month": 5},
                                 "location": {"lat": 21.02851, "lng": 105.85343, "city": "Hà Nội"}, "pseudonym": "Người kể A"}})
    mem_id = r.json()["intake_id"]
    assert site.call("PUT", f"/intake/v1/submissions/{mem_id}/files/1", jpg, "image/jpeg").json()["kind"] == "image"
    assert site.submit({"external_id": f"m-{tag}", "kind": "memory", "payload": {"text": "x"}}).json()["duplicate"]
    assert site.call("PUT", f"/intake/v1/submissions/{mem_id}/files/1", b"MZ" + b"\0" * 10, "image/jpeg").json()["duplicate"]
    case = site.submit({"external_id": f"c-{tag}", "kind": "case_report", "payload": {
        "group": "platform_restriction", "title": f"Tài khoản bị hạn chế {tag}",
        "description": f"Xem https://example.com/?intake-e2e={tag}", "location": {"lat": 10.7769, "lng": 106.7009}}}).json()
    assert case["links"] == 1
    assert site.call("GET", f"/intake/v1/receipts/{receipt}").json()["status"] == "received"

    # triage in the UI: create an incident from the case report
    with sync_playwright() as pw:
        b = pw.chromium.launch()
        page = b.new_page(viewport={"width": 1280, "height": 900})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(BASE + "/app/")
        page.fill("#token", TOKEN)
        page.click("#connect-btn")
        page.goto(BASE + f"/app/#/intake?project={proj['id']}")
        expect(page.get_by_text(f"Tài khoản bị hạn chế {tag}")).to_be_visible()
        page.get_by_text(f"Tài khoản bị hạn chế {tag}").click()
        page.get_by_role("button", name="Tạo vụ việc mới từ bài gửi").click()
        expect(page.locator(".inc-head h1")).to_contain_text(f"Tài khoản bị hạn chế {tag}")
        expect(page.get_by_text("Hạn chế mạng xã hội").first).to_be_visible()      # the group attribute
        expect(page.get_by_role("heading", name="Từ cộng đồng")).to_be_visible()
        incident_id = page.url.rsplit("/", 1)[-1]
        b.close()
    assert not errors, errors

    # the incident's public version: policy, two people
    wait_for(lambda: api("GET", f"/v1/incidents/{incident_id}")[1]["material"][0]["status"] in ("complete", "partial"))
    s, pub = api("POST", f"/v1/incidents/{incident_id}/publication")
    assert pub["draft"]["precision"] == "ward" and "10.7769" not in json.dumps(pub["preview"])
    s, pub = api("PATCH", f"/v1/publications/{pub['id']}", {"precision": "exact"})
    assert pub["problems"]
    assert api("POST", f"/v1/publications/{pub['id']}/approve", {"role": "manager"})[0] == 422
    api("PATCH", f"/v1/publications/{pub['id']}", {"precision": "ward", "place_label": "TP.HCM"})
    assert api("POST", f"/v1/publications/{pub['id']}/approve", {"role": "manager"})[0] == 200
    assert api("POST", f"/v1/publications/{pub['id']}/approve", {"role": "publisher"})[0] == 403   # no grant
    s, done = api("POST", f"/v1/publications/{pub['id']}/approve", {"role": "publisher"}, token=pubr["token"])
    assert done["state"] == "published"

    # the memory: the same person can't give both approvals
    s, mp = api("POST", f"/v1/intake/{mem_id}/publication")
    api("POST", f"/v1/publications/{mp['id']}/approve", {"role": "manager"})
    api("PUT", f"/v1/projects/{proj['id']}/members/{me['id']}/publish", {"can_publish": True})
    assert api("POST", f"/v1/publications/{mp['id']}/approve", {"role": "publisher"})[0] == 409
    assert api("POST", f"/v1/publications/{mp['id']}/approve", {"role": "publisher"}, token=pubr["token"])[1]["state"] == "published"
    assert site.call("GET", f"/intake/v1/receipts/{receipt}").json()["status"] == "published"

    # the feed, verified against the root key in the server's delegation (a site pins it from the README)
    root = httpx.get(BASE + "/feed/keys.json").json()["root_public"]
    recs = wait_for(lambda: (lambda r: r if {pub["public_id"], mp["public_id"]} <= set(r) else None)(load_feed(root)[0]))
    inc_rec, mem_rec = recs[pub["public_id"]], recs[mp["public_id"]]
    raw = json.dumps(inc_rec) + json.dumps(mem_rec)
    assert "10.7769" not in raw and "21.02851" not in raw and incident_id not in raw
    assert inc_rec["materials"][0]["original_url"].startswith("https://example.com/")
    f = mem_rec["files"][0]
    data = httpx.get(BASE + "/feed/" + f["url"]).content
    assert hashlib.sha256(data).hexdigest() == f["sha256"] and f["original_sha256"] == hashlib.sha256(jpg).hexdigest()
    from PIL import Image
    im = Image.open(io.BytesIO(data))
    assert im.format == "WEBP" and not dict(im.getexif())                       # GPS gone

    # withdrawal: tombstone, record and file gone
    s, w = api("POST", f"/v1/publications/{mp['id']}/withdraw", {"reason": "kiểm tra"}, token=pubr["token"])
    assert w["state"] == "withdrawn"
    wait_for(lambda: any(t["public_id"] == mp["public_id"] for t in load_feed(root)[1]))
    assert httpx.get(BASE + "/feed/" + f["url"]).status_code == 404

"""The replay viewer (replay.py) on its own origin: locked down, and it serves only what a signed URL allows.

Needs the compose `replay` service (REPLAY_BASE_URL, default http://replay:8701). Replay itself (the service worker)
was checked in a browser from localhost; this covers the server side. No external requests.
"""

import os

import httpx
import pytest

BASE = os.environ.get("REPLAY_BASE_URL", "http://replay:8701")
pytestmark = pytest.mark.skipif(not os.environ.get("E2E_BASE_URL"), reason="E2E_BASE_URL not set")


def test_viewer_is_locked_down():
    r = httpx.get(BASE + "/", timeout=10)
    csp = r.headers["content-security-policy"]
    assert r.status_code == 200 and "connect-src 'self'" in csp and "frame-ancestors 'none'" in csp
    assert "default-src 'self'" in csp and r.headers["referrer-policy"] == "no-referrer"
    assert "AGPL-3.0" in r.text                                       # the licence notice and its source link
    app = httpx.get(BASE + "/replay/", timeout=10)
    assert "frame-ancestors 'self'" in app.headers["content-security-policy"]
    sw = httpx.get(BASE + "/replay/sw.js", timeout=10)
    assert sw.status_code == 200 and sw.headers["service-worker-allowed"] == "/replay/"


def test_archive_needs_a_valid_signature():
    bad = "00000000-0000-0000-0000-000000000000"
    assert httpx.get(f"{BASE}/archive/{bad}.wacz?exp=1&sig=nope", timeout=10).status_code == 404
    assert httpx.get(f"{BASE}/archive/../../v1/me.wacz?exp=1&sig=x", timeout=10).status_code == 404
    assert httpx.get(f"{BASE}/v1/me", timeout=10).status_code == 404     # no API on this origin

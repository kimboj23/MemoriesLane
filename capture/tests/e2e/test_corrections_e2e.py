"""End-to-end: a person corrects a link's status and details when the machine got them wrong.

The sealed capture is untouched (the machine's verdict stays visible); every correction is logged.
Needs only example.com (no external services).
"""

import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(__file__))
from test_intake_e2e import api, wait_for  # noqa: E402

BASE = os.environ.get("E2E_BASE_URL", "")
TOKEN = os.environ.get("E2E_TOKEN", "")
pytestmark = pytest.mark.skipif(not (BASE and TOKEN), reason="E2E_BASE_URL / E2E_TOKEN not set")


def test_correct_status_and_details():
    s, r = api("POST", "/v1/inbox", {"url": f"https://example.com/?corr-e2e={int(time.time())}", "client": "api"})
    iid = r["item"]["id"]
    item = wait_for(lambda: (lambda x: x if x["status"] not in ("queued", "capturing") else None)(api("GET", f"/v1/items/{iid}")[1]))
    machine = item["status"]
    manifest = item["captures"][0]["manifest_sha256"]

    assert api("PATCH", f"/v1/items/{iid}/corrections", {"status": "unavailable"})[0] == 422      # a reason is required
    s, c = api("PATCH", f"/v1/items/{iid}/corrections", {"status": "unavailable", "reason": "Kiểm tra bằng tài khoản đăng nhập",
                                                          "author": "Nguyễn Văn A", "published_at": "2026-10-01", "title": "Tiêu đề sửa"})
    assert s == 200 and c["status"] == "unavailable" and c["machine_status"] == machine
    assert c["title"] == "Tiêu đề sửa" and c["correction"]["fields"]["author"] == "Nguyễn Văn A"
    assert c["correction"]["reason"].startswith("Kiểm tra") and len(c["corrections_log"]) == 1
    assert api("PATCH", f"/v1/items/{iid}/corrections", {"published_at": "01/10/2026"})[0] == 422  # dates as YYYY-MM-DD
    s, lst = api("GET", "/v1/items?mine=false&status=unavailable&limit=200")
    assert iid in [x["id"] for x in lst["items"]]                                                  # filters use the correction

    s, item = api("GET", f"/v1/items/{iid}")
    assert item["captures"][0]["verdict"] == machine and item["captures"][0]["manifest_sha256"] == manifest   # sealed, untouched

    # Back to the machine's status; clearing a field returns the machine's value.
    s, c = api("PATCH", f"/v1/items/{iid}/corrections", {"status": "", "author": ""})
    assert c["status"] == machine and c["correction"]["status"] is None and "author" not in c["correction"]["fields"]
    assert len(c["corrections_log"]) == 2

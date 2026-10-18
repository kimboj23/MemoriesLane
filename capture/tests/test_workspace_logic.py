"""Pure logic behind the workspace: roles, mentions, CSV import, the Wayback policy and SPN2 client (no network)."""

import asyncio
import json

import httpx

from memlane_capture import external
from memlane_capture.access import at_least
from memlane_capture.importer import parse
from memlane_capture.notify import find_mentions


# ---- roles ------------------------------------------------------------------------------------
def test_role_ladder():
    assert at_least("owner", "manager") and at_least("manager", "editor") and at_least("editor", "viewer")
    assert not at_least("viewer", "editor") and not at_least("data_only_viewer", "viewer")
    assert not at_least(None, "data_only_viewer")


# ---- mentions ----------------------------------------------------------------------------------
PEOPLE = [("1", "Lan"), ("2", "Lan Anh"), ("3", "Trần Thị B"), ("4", "Minh")]


def test_mentions_full_names_longest_first():
    assert find_mentions("@Lan Anh xem giúp nhé", PEOPLE) == {"2"}
    assert find_mentions("@lan và @Trần Thị B", PEOPLE) == {"1", "3"}


def test_mentions_need_the_at_sign_and_a_word_boundary():
    assert find_mentions("Minh đã xác minh", PEOPLE) == set()
    assert find_mentions("email lan@example.org", PEOPLE) == set()
    assert find_mentions("@Minhxyz", PEOPLE) == set()


# ---- CSV import --------------------------------------------------------------------------------
ATTRS = [{"id": "a1", "name": "Loại tư liệu", "type": "select", "options": ["Thông báo", "Video"]},
         {"id": "a2", "name": "Nguồn", "type": "multi_select", "options": []}]


def test_import_vietnamese_headers_and_labels():
    csv = ("mô tả,trạng thái,nhạy cảm,chủ đề,ngày,địa điểm,vĩ độ,kinh độ,độ chính xác,liên kết,Loại tư liệu,Nguồn\n"
           "Thông báo thu hồi đất,Đang làm,Lộ thông tin cá nhân,cưỡng chế|tái định cư,2026-08-20,Hồng Hà,21.04,105.86,"
           "locality,https://example.org/a https://example.org/b,Thông báo,báo|mạng xã hội\n")
    rows, errs = parse(csv, ATTRS)
    assert errs == [] and len(rows) == 1 and rows[0]["errors"] == []
    v = rows[0]["values"]
    assert v["status"] == "in_progress" and v["sensitive"] == ["personal_info"]
    assert v["tags"] == ["cưỡng chế", "tái định cư"] and v["event_date"] == "2026-08-20"
    assert (v["lat"], v["lng"], v["geo_precision"]) == (21.04, 105.86, "locality")
    assert v["custom"] == {"a1": "Thông báo", "a2": ["báo", "mạng xã hội"]}
    assert rows[0]["urls"] == ["https://example.org/a", "https://example.org/b"]


def test_import_english_codes_semicolon_file_and_bom():
    rows, errs = parse("﻿Description;Status;Sensitive\nA;ready_for_review;not_sensitive\n", [])
    assert errs == [] and rows[0]["values"]["status"] == "ready_for_review"


def test_import_reports_row_errors():
    csv = "description,status,date,lat,Loại tư liệu,xyz\n,Maybe,20/08/2026,91,Ảnh,1\n"
    rows, errs = parse(csv, ATTRS)
    assert any("unknown column" in e for e in errs)
    e = " | ".join(rows[0]["errors"])
    for needle in ("unknown status", "YYYY-MM-DD", "lat '91'", "not an option", "description is empty"):
        assert needle in e, needle
    rows, _ = parse("description,lat\nA,21.0\n", [])
    assert rows[0]["errors"] == ["lat and lng must both be given"]


def test_import_requires_description_column():
    rows, errs = parse("status\nto_do\n", [])
    assert rows == [] and any("description" in e for e in errs)


# ---- Wayback policy ----------------------------------------------------------------------------
def test_wayback_targets():
    url, skip = external.target_for("facebook", "post", "https://www.facebook.com/a/posts/pfbid0EX")
    assert url.startswith("https://www.facebook.com/plugins/post.php?href=https%3A%2F%2Fwww.facebook.com") and not skip
    assert external.target_for("facebook", "video", "https://www.facebook.com/reel/1")[0].startswith(
        "https://www.facebook.com/plugins/video.php")
    assert external.target_for("threads", "post", "https://www.threads.com/@a/post/B") == (
        None, "Wayback cannot capture threads posts (it stores the login/error page)")
    assert external.target_for("instagram", "video", "x")[0] is None
    assert external.target_for("web", "article", "https://vnexpress.net/a.html") == ("https://vnexpress.net/a.html", None)


def _fake_ia(statuses):
    """A stand-in for web.archive.org's SPN2 API."""
    seq = iter(statuses)

    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"].startswith("LOW ")
        if request.url.path == "/save":
            return httpx.Response(200, json={"job_id": "spn2-1", "url": "x"})
        return httpx.Response(200, json=next(seq))
    return httpx.AsyncClient(transport=httpx.MockTransport(handler), base_url="https://web.archive.org")


def test_spn_success(monkeypatch):
    monkeypatch.setattr(external, "POLL_SECONDS", 0)
    client = _fake_ia([{"status": "pending"}, {"status": "success", "timestamp": "20261018101010",
                                                "original_url": "https://vnexpress.net/a.html"}])
    copy, err, retry = asyncio.run(external.submit("https://vnexpress.net/a.html", client))
    assert copy == "https://web.archive.org/web/20261018101010/https://vnexpress.net/a.html" and err is None


def test_spn_error_is_reported_and_quota_is_retryable(monkeypatch):
    monkeypatch.setattr(external, "POLL_SECONDS", 0)
    copy, err, retry = asyncio.run(external.submit("u", _fake_ia([{"status": "error", "status_ext": "error:blocked-url"}])))
    assert copy is None and "blocked-url" in err and retry is False
    copy, err, retry = asyncio.run(external.submit("u", _fake_ia([{"status": "error",
                                                                    "status_ext": "error:too-many-daily-captures"}])))
    assert retry is True


def test_spn_busy_is_retryable():
    client = httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(429, text="slow down")))
    copy, err, retry = asyncio.run(external.submit("u", client))
    assert copy is None and retry is True and "429" in err

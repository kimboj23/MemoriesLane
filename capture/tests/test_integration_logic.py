"""Community intake and publication: the pure logic (offline). The flow itself is in tests/e2e."""

import json
from datetime import datetime, timedelta, timezone

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from memlane_capture import feedkeys, geo
from memlane_capture.derive import sniff
from memlane_capture.feed import public_record
from memlane_capture.intake import (CaseReportPayload, MemoryPayload, Submission, found_links, incident_from_submission,
                                    signature)


# ---- §12.4 location policy ------------------------------------------------------------------------
@pytest.mark.parametrize("kind,precision,reason,ok", [
    ("public_institution", "exact", None, True),
    ("public_gathering", "street", None, True),
    ("public_gathering", "exact", None, False),          # finer than default: needs a reason
    ("public_gathering", "exact", "widely reported", True),
    ("private_city", "ward", None, True),
    ("private_city", "street", "any reason", False),     # never finer
    ("private_city", "province", None, True),            # coarser is always fine
    ("private_rural", "ward", "large commune", True),
    ("private_rural", "street", "x", False),
    ("online", "none", None, True),
    ("online", "province", "said so publicly", True),
    ("online", "ward", "x", False),
    ("legacy_memory", "exact", None, True),
])
def test_policy(kind, precision, reason, ok):
    if ok:
        geo.check(kind, precision, reason)
    else:
        with pytest.raises(geo.PolicyError):
            geo.check(kind, precision, reason)


def test_memory_finer_needs_submitter_consent_and_respects_ceiling():
    with pytest.raises(geo.PolicyError):
        geo.check("memory", "street", "public square")                       # submitter didn't allow exact
    geo.check("memory", "street", "public square", submitter_allows_exact=True)
    with pytest.raises(geo.PolicyError):
        geo.check("memory", "ward", None, submitter_max="province")          # finer than the submitter asked
    geo.check("memory", "province", None, submitter_max="province")


def test_snap_is_deterministic_and_coarse():
    a, b = geo.snap(21.02851, 105.85343, "ward"), geo.snap(21.02852, 105.85344, "ward")
    assert a == b and a["radius_m"] == 2000
    assert (a["lat"], a["lng"]) != (21.02851, 105.85343)
    assert abs(a["lat"] - 21.02851) < geo.GRID_DEG["ward"]
    assert geo.snap(10.7769, 106.7009, "none") is None
    assert geo.snap(None, None, "exact") is None
    assert geo.snap(10.776912, 106.700934, "exact")["lat"] == 10.77691


def test_coarsen_date():
    assert geo.coarsen_date("2026-03-14", "month") == {"value": "2026-03", "precision": "month"}
    assert geo.coarsen_date("2026-03-14", "year") == {"value": "2026", "precision": "year"}
    assert geo.coarsen_date(None) is None


# ---- feed keys (option C) ----------------------------------------------------------------------------
def _keys():
    root, online = Ed25519PrivateKey.generate(), Ed25519PrivateKey.generate()
    return root, online, feedkeys.public_b64(root), feedkeys.public_b64(online)


def test_delegation_valid_expired_revoked_and_foreign():
    root, online, root_pub, online_pub = _keys()
    d = feedkeys.make_delegation(root, online_pub, days=30)
    assert feedkeys.check_delegation(d, root_pub, online_pub) is None
    later = datetime.now(timezone.utc) + timedelta(days=31)
    assert "expired" in feedkeys.check_delegation(d, root_pub, online_pub, now=later)
    rev = feedkeys.make_revocation(root, online_pub, "laptop lost")
    assert feedkeys.check_delegation(d, root_pub, online_pub, [rev]) == "online key revoked"
    other_root = Ed25519PrivateKey.generate()
    assert "pinned root" in feedkeys.check_delegation(d, feedkeys.public_b64(other_root), online_pub)
    forged = feedkeys.make_delegation(other_root, online_pub, days=30)
    forged["root_public"] = root_pub                       # claims the real root, signed by another
    assert "pinned root" in feedkeys.check_delegation(forged, root_pub, online_pub)
    # a revocation not signed by the root is ignored
    fake_rev = feedkeys.make_revocation(other_root, online_pub)
    assert feedkeys.check_delegation(d, root_pub, online_pub, [fake_rev]) is None


def test_statement_is_signed_as_exact_bytes():
    root, _, root_pub, online_pub = _keys()
    d = feedkeys.make_delegation(root, online_pub, days=1)
    tampered = dict(d, statement=d["statement"].replace(online_pub, online_pub[:-4] + "AAA="))
    assert feedkeys.check_delegation(tampered, root_pub, online_pub) is not None


# ---- intake ----------------------------------------------------------------------------------------------
def test_signature_binds_every_part():
    base = signature("k" * 64, "1700000000", "n" * 20, "POST", "/intake/v1/submissions", "ab" * 32)
    assert base == signature("k" * 64, "1700000000", "n" * 20, "post", "/intake/v1/submissions", "ab" * 32)
    for args in [("1700000001", "n" * 20, "POST", "/intake/v1/submissions", "ab" * 32),
                 ("1700000000", "m" * 20, "POST", "/intake/v1/submissions", "ab" * 32),
                 ("1700000000", "n" * 20, "PUT", "/intake/v1/submissions", "ab" * 32),
                 ("1700000000", "n" * 20, "POST", "/intake/v1/receipts", "ab" * 32),
                 ("1700000000", "n" * 20, "POST", "/intake/v1/submissions", "cd" * 32)]:
        assert signature("k" * 64, *args) != base


def test_found_links_from_declared_and_text():
    sub = Submission(external_id="x1", kind="case_report", payload={}, links=["https://a.example/1"])
    pl = CaseReportPayload(group="violation", title="T", description="xem https://b.example/2, và https://a.example/1.",
                           fields={"nguồn": "https://c.example/3)"})
    assert found_links(sub, pl) == ["https://a.example/1", "https://b.example/2", "https://c.example/3"]


def test_incident_prefill_sets_group_attribute_and_never_invents_a_date():
    k = {"kind": "case_report", "payload": CaseReportPayload(
        group="platform_restriction", title="Tài khoản bị khoá", description="Mô tả",
        date={"year": 2026, "month": 2, "day": 30}, location={"lat": 10.1, "lng": 106.2, "city": "TP.HCM"}).model_dump()}
    attrs = [{"id": "g1", "name": "Nhóm hồ sơ", "type": "select",
              "options": ["Vi phạm", "Tố tụng", "Hạn chế mạng xã hội", "Phong trào xã hội"]}]
    out = incident_from_submission(k, attrs)
    assert out["custom"] == {"g1": "Hạn chế mạng xã hội"}
    assert "event_date" not in out                         # 30 February is not a date
    assert out["description"].startswith("Tài khoản bị khoá") and out["lat"] == 10.1
    assert "custom" not in incident_from_submission(k, [])  # no such attribute in the project: nothing set


def test_memory_payload_limits():
    with pytest.raises(ValueError):
        MemoryPayload(text="")
    with pytest.raises(ValueError):
        MemoryPayload(text="x", category="other")


@pytest.mark.parametrize("head,expected", [
    (b"\xff\xd8\xff\xe0" + b"\0" * 20, ("image", "image/jpeg")),
    (b"\x89PNG\r\n\x1a\n" + b"\0" * 8, ("image", "image/png")),
    (b"RIFF\0\0\0\0WEBPVP8 ", ("image", "image/webp")),
    (b"\0\0\0\x18ftypmp42", ("video", "video/mp4")),
    (b"\x1a\x45\xdf\xa3" + b"\0" * 8, ("video", "video/webm")),
    (b"%PDF-1.7\n", ("pdf", "application/pdf")),
    (b"<html><script>", None),
    (b"MZ\x90\0", None),
])
def test_sniff(head, expected):
    assert sniff(head) == expected


# ---- the public record ------------------------------------------------------------------------------------
def test_public_record_never_contains_internal_location_or_ids():
    snap = {"title_vi": "Tiêu đề", "summary_vi": "Tóm tắt", "lat": 10.776912, "lng": 106.700934, "precision": "ward",
            "place_kind": "private_city", "place_label": "Quận 1, TP.HCM", "date": "2026-03-14", "date_precision": "month",
            "public_status": "being_verified",
            "materials": [{"item_id": "11111111-2222-3333-4444-555555555555", "public_id": "mt-abc", "show_original_url": False,
                           "original_url": "https://www.facebook.com/user.b/posts/PostCode001", "platform": "facebook",
                           "verdict": "restricted", "manifest_sha256": "f" * 64, "frozen_files": []}]}
    rec = public_record("incident", "hs-xyz", 1, "2026-10-19T00:00:00+00:00", snap, resolve=None)
    raw = json.dumps(rec)
    assert "10.776912" not in raw and "106.700934" not in raw
    assert "11111111-2222" not in raw and "PostCode001" not in raw      # original URL withheld for this material
    assert rec["location"]["precision"] == "ward" and rec["date"] == {"value": "2026-03", "precision": "month"}
    assert rec["materials"][0]["public_status"] == "restricted"
    snap["materials"][0]["show_original_url"] = True
    assert public_record("incident", "hs-xyz", 1, None, snap, None)["materials"][0]["original_url"].endswith("PostCode001")


def test_files_that_could_not_be_cleaned_are_left_out():
    snap = {"text_vi": "x", "precision": "none", "frozen_community_files": [
        {"source": "intake_file", "id": "a", "kind": "image", "source_sha256": "1" * 64},
        {"source": "intake_file", "id": "b", "kind": "image", "source_sha256": "2" * 64}]}
    clean = {"1" * 64: {"path": "files/x.webp", "sha256": "9" * 64, "bytes": 10, "mime": "image/webp", "kind": "image"}}
    rec = public_record("memory", "km-1", 1, None, snap, resolve=lambda f: clean.get(f["source_sha256"]))
    assert [f["url"] for f in rec["files"]] == ["files/x.webp"]
    assert rec["files"][0]["provided_by"] == "contributor" and rec["location"] is None


def test_role_tags_in_comments():
    from memlane_capture.notify import find_role_tags
    assert find_role_tags("@reviewer xem giúp") == {"reviewer"}
    assert find_role_tags("nhờ @quanly và @BienTap, cả @tatca") == {"manager", "editor", "all"}
    assert find_role_tags("email a@reviewer.org, @reviewers, @Lan Anh") == set()     # not tags
    assert find_role_tags("(@nguoiduyet)") == {"reviewer"}


def test_precision_menu_offers_only_allowed_levels():
    lv = lambda kind, **kw: [(o["level"], o["needs_reason"]) for o in geo.options(kind, **kw)]   # noqa: E731
    assert lv("private_city") == [("ward", False), ("province", False), ("none", False)]       # never finer
    assert lv("public_gathering")[:2] == [("exact", True), ("street", False)]                  # finer: with a reason
    assert ("exact", True) not in lv("memory")                                                  # no consent
    assert ("exact", True) in lv("memory", submitter_allows_exact=True)
    assert lv("memory", submitter_max="province") == [("province", False), ("none", False)]    # the submitter's ceiling
    try:
        geo.check("public_gathering", "exact")
    except geo.PolicyError as e:
        assert e.code == "needs_reason" and e.params == {"default": "street"}

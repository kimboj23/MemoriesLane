"""Upkeep helpers, offline: RFC 3161 request/response checks (tsa.py) and photo fingerprints (phash.py)."""

import hashlib
import io
from datetime import datetime, timezone

import pytest
from asn1crypto import algos, cms, core, tsp
from PIL import Image, ImageDraw

from memlane_capture import phash, tsa

H = hashlib.sha256(b"manifest").hexdigest()


def _response(hash_hex, nonce, status="granted", when=datetime(2026, 10, 21, 8, 30, tzinfo=timezone.utc)):
    """A TimeStampResp as an authority would send it (unsigned: only the parts tsa.parse_response reads)."""
    tst = tsp.TSTInfo({
        "version": "v1", "policy": "1.2.3.4",
        "message_imprint": {"hash_algorithm": algos.DigestAlgorithm({"algorithm": "sha256"}),
                            "hashed_message": bytes.fromhex(hash_hex)},
        "serial_number": 1, "gen_time": when, "nonce": nonce})
    signed = cms.SignedData({
        "version": "v3", "digest_algorithms": [algos.DigestAlgorithm({"algorithm": "sha256"})],
        "encap_content_info": {"content_type": "tst_info", "content": core.ParsableOctetString(tst.dump())},
        "signer_infos": []})
    return tsp.TimeStampResp({"status": {"status": status},
                              "time_stamp_token": cms.ContentInfo({"content_type": "signed_data", "content": signed})}).dump()


def test_request_carries_only_the_hash():
    req = tsp.TimeStampReq.load(tsa.build_request(H, 42))
    assert req["message_imprint"]["hashed_message"].native == bytes.fromhex(H)
    assert req["message_imprint"]["hash_algorithm"]["algorithm"].native == "sha256"
    assert req["nonce"].native == 42 and req["cert_req"].native is True


def test_response_checks():
    assert tsa.parse_response(_response(H, 7), H, 7) == datetime(2026, 10, 21, 8, 30, tzinfo=timezone.utc)
    with pytest.raises(tsa.TimestampError, match="different hash"):
        tsa.parse_response(_response(hashlib.sha256(b"other").hexdigest(), 7), H, 7)
    with pytest.raises(tsa.TimestampError, match="nonce"):
        tsa.parse_response(_response(H, 8), H, 7)
    rejected = bytes.fromhex("3005300302010" + "2")   # TimeStampResp { status: rejection (2) }, no token
    with pytest.raises(tsa.TimestampError, match="rejection"):
        tsa.parse_response(rejected, H, 7)


def _photo(seed: int, size=(640, 480)) -> Image.Image:
    im = Image.new("RGB", size, (30 + seed * 40 % 200, 90, 160))
    d = ImageDraw.Draw(im)
    for i in range(12):
        x = (seed * 97 + i * 53) % size[0]
        y = (seed * 31 + i * 71) % size[1]
        d.ellipse([x, y, x + 120, y + 90], fill=((i * 40) % 255, (seed * 60 + i * 20) % 255, (i * 90) % 255))
    return im


def _bytes(im: Image.Image, fmt="JPEG", **kw) -> io.BytesIO:
    b = io.BytesIO()
    im.save(b, fmt, **kw)
    b.seek(0)
    return b


def test_fingerprint_finds_the_same_photo_resized_and_recompressed():
    a = _photo(1)
    original = phash.dhash(_bytes(a, quality=95))
    smaller = phash.dhash(_bytes(a.resize((320, 240)), quality=60))
    as_png = phash.dhash(_bytes(a, "PNG"))
    other = phash.dhash(_bytes(_photo(5), quality=95))
    assert -(1 << 63) <= original < (1 << 63)                    # fits a Postgres bigint
    assert phash.distance(original, smaller) <= phash.SIMILAR_BITS
    assert phash.distance(original, as_png) <= phash.SIMILAR_BITS
    assert phash.distance(original, other) > phash.SIMILAR_BITS

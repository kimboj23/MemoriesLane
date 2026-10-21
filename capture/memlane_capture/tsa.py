"""Trusted timestamps (RFC 3161) for a capture's manifest hash.

A timestamping authority (TSA) signs "this hash existed at this time". Only the hash is sent: the authority learns
nothing about what was captured. With the sealed manifest (seal.py) this proves both what was captured and that
it existed no later than the signed time, which a hash alone cannot.

Anyone can check a token offline:
    openssl ts -verify -digest <manifest sha256> -in <token>.tsr -CAfile <the authority's CA certificate>
"""

import secrets
from datetime import datetime

import httpx
from asn1crypto import algos, core, parser, tsp


class TimestampError(Exception):
    pass


def build_request(hash_hex: str, nonce: int) -> bytes:
    return tsp.TimeStampReq({
        "version": 1,
        "message_imprint": tsp.MessageImprint({
            "hash_algorithm": algos.DigestAlgorithm({"algorithm": "sha256"}),
            "hashed_message": bytes.fromhex(hash_hex)}),
        "nonce": core.Integer(nonce),
        "cert_req": True,                      # the token carries the authority's certificate: checkable offline
    }).dump()


def parse_response(der: bytes, hash_hex: str, nonce: int) -> datetime:
    """The signed time, after checking the token answers this request (status, hash, nonce)."""
    # The status first, on its own: a refusal carries no token, and asn1crypto can't load a TimeStampResp without one.
    try:
        contents = parser.parse(der)[4]
        status = tsp.PKIStatusInfo.load(contents[:parser.peek(contents)])["status"].native
    except ValueError as e:
        raise TimestampError(f"not a timestamp response: {e}") from e
    if status not in ("granted", "granted_with_mods"):
        raise TimestampError(f"authority answered {status}")
    tst = tsp.TimeStampResp.load(der)["time_stamp_token"]["content"]["encap_content_info"]["content"].parsed
    if tst["message_imprint"]["hashed_message"].native != bytes.fromhex(hash_hex):
        raise TimestampError("token is for a different hash")
    if tst["nonce"].native != nonce:
        raise TimestampError("token answers a different request (nonce)")
    return tst["gen_time"].native


def request_timestamp(url: str, hash_hex: str, timeout: float = 30) -> tuple[bytes, datetime]:
    """(DER TimeStampResp, signed time) from the authority at `url`."""
    nonce = secrets.randbits(63)
    r = httpx.post(url, content=build_request(hash_hex, nonce), timeout=timeout,
                   headers={"Content-Type": "application/timestamp-query", "Accept": "application/timestamp-reply"})
    if r.status_code != 200:
        raise TimestampError(f"HTTP {r.status_code}")
    return r.content, parse_response(r.content, hash_hex, nonce)

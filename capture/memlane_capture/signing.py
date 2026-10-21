"""Short-lived signed artifact URLs.

<img>, <video> and <iframe> can't send an Authorization header, so the API
hands authorised users artifact URLs carrying an expiry and an HMAC. A URL
is only ever issued to someone who could already read that artifact, and it
names exactly one artifact.

Set ARTIFACT_URL_SECRET in production (shared by all API processes). Without
it a random per-process secret is used, which is fine for one local process.
"""

import hashlib
import hmac
import os
import secrets
import time

_SECRET = (os.environ.get("ARTIFACT_URL_SECRET") or "").encode() or secrets.token_bytes(32)
TTL_SECONDS = 6 * 3600


def _mac(artifact_id: str, exp: int) -> str:
    return hmac.new(_SECRET, f"{artifact_id}.{exp}".encode(), hashlib.sha256).hexdigest()[:40]


def artifact_url(artifact_id) -> str:
    exp = int(time.time()) + TTL_SECONDS
    return f"/v1/artifacts/{artifact_id}?exp={exp}&sig={_mac(str(artifact_id), exp)}"


def intake_file_url(file_id) -> str:
    """Same scheme for files sent by the community (a separate namespace, so the two ids can't be swapped)."""
    exp = int(time.time()) + TTL_SECONDS
    return f"/v1/intake-files/{file_id}?exp={exp}&sig={_mac('if:' + str(file_id), exp)}"


def timestamp_url(token_sha256: str) -> str:
    """A capture's RFC 3161 token (upkeep.py); its own namespace."""
    exp = int(time.time()) + TTL_SECONDS
    return f"/v1/timestamps/{token_sha256}.tsr?exp={exp}&sig={_mac('ts:' + token_sha256, exp)}"


def verify(artifact_id: str, exp: str | None, sig: str | None) -> bool:
    if not exp or not sig or not exp.isdigit() or int(exp) < time.time():
        return False
    return hmac.compare_digest(_mac(artifact_id, int(exp)), sig)


def verify_intake_file(file_id: str, exp: str | None, sig: str | None) -> bool:
    return verify("if:" + file_id, exp, sig)

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


def verify(artifact_id: str, exp: str | None, sig: str | None) -> bool:
    if not exp or not sig or not exp.isdigit() or int(exp) < time.time():
        return False
    return hmac.compare_digest(_mac(artifact_id, int(exp)), sig)

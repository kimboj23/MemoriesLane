"""Signing keys for the publication feed: an offline root key and a short-lived online key (integration-design
§13, option C, decided 2026-10-18).

  root key     generated and kept OFFLINE by the designated maintainer (sealed backup with a second person).
               Never on the server. Its public key is pinned by every site and mirror.
  online key   lives on the server (FEED_ONLINE_KEY) and signs every feed build.
  delegation   a statement signed by the root: "online key K is valid from A until B" (FEED_DELEGATION).
  revocation   a statement signed by the root: "online key K is revoked" (FEED_REVOCATIONS, one per line).

Signatures are over exact bytes: the delegation carries its statement as a string, and the feed's index.json
is signed as written. Verifiers never need to re-serialise JSON. Keys are raw Ed25519, base64.

    python -m memlane_capture.feedkeys root-init  --out /media/usb/feed-root.key     # on an offline machine
    python -m memlane_capture.feedkeys online-init --out capture/secrets/feed-online.key
    python -m memlane_capture.feedkeys delegate --root /media/usb/feed-root.key --online-public <b64> --days 120 \
        --out capture/secrets/feed-delegation.json
    python -m memlane_capture.feedkeys revoke --root /media/usb/feed-root.key --online-public <b64> \
        >> capture/secrets/feed-revocations.jsonl
    python -m memlane_capture.feedkeys show                                          # what the server has
"""

import argparse
import base64
import json
import os
import sys
from datetime import datetime, timedelta, timezone

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

DELEGATION_SCHEMA = "memlane-feed-delegation/1"
REVOCATION_SCHEMA = "memlane-feed-revocation/1"


def b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def public_b64(key: Ed25519PrivateKey) -> str:
    return b64(key.public_key().public_bytes(serialization.Encoding.Raw, serialization.PublicFormat.Raw))


def private_b64(key: Ed25519PrivateKey) -> str:
    return b64(key.private_bytes(serialization.Encoding.Raw, serialization.PrivateFormat.Raw,
                                 serialization.NoEncryption()))


def load_private(value: str) -> Ed25519PrivateKey:
    """A key file path, or the base64 key itself."""
    raw = open(value, encoding="ascii").read().strip() if os.path.isfile(value) else value.strip()
    return Ed25519PrivateKey.from_private_bytes(base64.b64decode(raw))


def load_public(b64key: str) -> Ed25519PublicKey:
    return Ed25519PublicKey.from_public_bytes(base64.b64decode(b64key))


def sign(key: Ed25519PrivateKey, data: bytes) -> str:
    return b64(key.sign(data))


def verify(pub_b64: str, data: bytes, sig_b64: str) -> bool:
    try:
        load_public(pub_b64).verify(base64.b64decode(sig_b64), data)
        return True
    except (InvalidSignature, ValueError):
        return False


def make_delegation(root: Ed25519PrivateKey, online_public: str, days: int, now: datetime | None = None) -> dict:
    now = now or datetime.now(timezone.utc)
    statement = json.dumps({"schema": DELEGATION_SCHEMA, "online_public": online_public,
                            "not_before": now.replace(microsecond=0).isoformat(),
                            "not_after": (now + timedelta(days=days)).replace(microsecond=0).isoformat()},
                           sort_keys=True, separators=(",", ":"))
    return {"root_public": public_b64(root), "statement": statement, "signature": sign(root, statement.encode())}


def make_revocation(root: Ed25519PrivateKey, online_public: str, reason: str = "") -> dict:
    statement = json.dumps({"schema": REVOCATION_SCHEMA, "online_public": online_public, "reason": reason,
                            "revoked_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat()},
                           sort_keys=True, separators=(",", ":"))
    return {"root_public": public_b64(root), "statement": statement, "signature": sign(root, statement.encode())}


def check_delegation(d: dict, root_public: str, online_public: str, revocations: list[dict] = (),
                     now: datetime | None = None) -> str | None:
    """None if `online_public` may sign now under `root_public`, else why not. Same rules as the JS verifier."""
    now = now or datetime.now(timezone.utc)
    if d.get("root_public") != root_public or not verify(root_public, d["statement"].encode(), d["signature"]):
        return "delegation not signed by the pinned root key"
    s = json.loads(d["statement"])
    if s.get("schema") != DELEGATION_SCHEMA or s.get("online_public") != online_public:
        return "delegation is for another key"
    if not (datetime.fromisoformat(s["not_before"]) <= now <= datetime.fromisoformat(s["not_after"])):
        return "delegation expired or not yet valid"
    for r in revocations:
        if verify(root_public, r["statement"].encode(), r["signature"]):
            rs = json.loads(r["statement"])
            if rs.get("schema") == REVOCATION_SCHEMA and rs.get("online_public") == online_public:
                return "online key revoked"
    return None


def server_keys(settings) -> tuple[Ed25519PrivateKey, dict, list[dict]] | None:
    """The server's online key, delegation and revocations, or None if the feed isn't configured."""
    if not settings.feed_online_key or not settings.feed_delegation:
        return None
    online = load_private(settings.feed_online_key)
    delegation = json.load(open(settings.feed_delegation, encoding="utf-8"))
    revocations = []
    if settings.feed_revocations and os.path.isfile(settings.feed_revocations):
        revocations = [json.loads(line) for line in open(settings.feed_revocations, encoding="utf-8") if line.strip()]
    return online, delegation, revocations


def _write_secret(path: str, text: str) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="ascii") as f:
        f.write(text + "\n")


def main() -> None:
    ap = argparse.ArgumentParser(prog="memlane_capture.feedkeys")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("root-init", "online-init"):
        s = sub.add_parser(name)
        s.add_argument("--out", required=True, help="private key file to create (never overwritten)")
    d = sub.add_parser("delegate")
    d.add_argument("--root", required=True)
    d.add_argument("--online-public", required=True)
    d.add_argument("--days", type=int, default=120)
    d.add_argument("--out", help="write here instead of stdout")
    r = sub.add_parser("revoke")
    r.add_argument("--root", required=True)
    r.add_argument("--online-public", required=True)
    r.add_argument("--reason", default="")
    sub.add_parser("show")
    a = ap.parse_args()

    if a.cmd in ("root-init", "online-init"):
        key = Ed25519PrivateKey.generate()
        _write_secret(a.out, private_b64(key))
        print(f"private key written to {a.out} (mode 600)", file=sys.stderr)
        if a.cmd == "root-init":
            print("Keep it offline. Make the sealed backup now. Pin this ROOT PUBLIC KEY on every site:",
                  file=sys.stderr)
        print(public_b64(key))
    elif a.cmd == "delegate":
        out = json.dumps(make_delegation(load_private(a.root), a.online_public, a.days), indent=2)
        if a.out:
            open(a.out, "w", encoding="utf-8").write(out + "\n")
            print(f"delegation written to {a.out}", file=sys.stderr)
        else:
            print(out)
    elif a.cmd == "revoke":
        print(json.dumps(make_revocation(load_private(a.root), a.online_public, a.reason)))
    elif a.cmd == "show":
        from .config import settings
        keys = server_keys(settings)
        if not keys:
            raise SystemExit("feed signing not configured (FEED_ONLINE_KEY, FEED_DELEGATION)")
        online, delegation, revocations = keys
        problem = check_delegation(delegation, delegation["root_public"], public_b64(online), revocations)
        print(json.dumps({"root_public": delegation["root_public"], "online_public": public_b64(online),
                          "delegation": json.loads(delegation["statement"]), "revocations": len(revocations),
                          "usable": problem is None, "problem": problem}, indent=2))


if __name__ == "__main__":
    main()

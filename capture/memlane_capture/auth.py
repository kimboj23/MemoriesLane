"""Personal API tokens.

Every contributor gets their own revocable token per device (phone shortcut,
browser extension, ...) instead of the old shared admin token. Only the
SHA-256 of a token is stored. Roles:

  contributor  submit links, see and edit own items
  reviewer     + see everyone's items, re-capture
  editor       + edit anyone's item metadata
  admin        everything (managed through the admin CLI for now)
"""

import hashlib
import secrets
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

TOKEN_PREFIX = "mlc_"
ROLE_RANK = {"contributor": 0, "reviewer": 1, "editor": 2, "admin": 3}


def new_token() -> str:
    return TOKEN_PREFIX + secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Principal:
    contributor_id: str
    display_name: str
    role: str
    token_id: str
    token_label: str

    def at_least(self, role: str) -> bool:
        return ROLE_RANK[self.role] >= ROLE_RANK[role]


async def current_principal(request: Request) -> Principal:
    header = request.headers.get("authorization", "")
    token = header[7:].strip() if header.lower().startswith("bearer ") else ""
    if not token.startswith(TOKEN_PREFIX):
        raise HTTPException(401, "missing or malformed token", headers={"WWW-Authenticate": "Bearer"})
    async with request.app.state.pool.connection() as conn:
        row = await (await conn.execute(
            "SELECT t.id AS token_id, t.label, c.id AS contributor_id, c.display_name, c.role"
            "  FROM capture.tokens t JOIN capture.contributors c ON c.id = t.contributor_id"
            " WHERE t.token_sha256 = %s AND t.revoked_at IS NULL AND c.disabled_at IS NULL",
            (hash_token(token),))).fetchone()
        if not row:
            raise HTTPException(401, "invalid or revoked token", headers={"WWW-Authenticate": "Bearer"})
        await conn.execute("UPDATE capture.tokens SET last_used_at = now() WHERE id = %s"
                           " AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')",
                           (row["token_id"],))
    return Principal(str(row["contributor_id"]), row["display_name"], row["role"], str(row["token_id"]), row["label"])


def require(role: str):
    async def dep(p: Principal = Depends(current_principal)) -> Principal:
        if not p.at_least(role):
            raise HTTPException(403, f"requires role {role}")
        return p
    return dep

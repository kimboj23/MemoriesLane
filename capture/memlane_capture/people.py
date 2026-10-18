"""People: project members and roles, invite links, the admin's user management, notifications.

Invite links (Atlos): an owner creates a link that grants one project role, optionally expiring and limited to
a number of uses. Someone who opens it either joins with their current account, or, if they have none,
picks a display name and gets a new account plus a personal token, shown once. Only the SHA-256 of the
invite code is stored.
"""

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from .access import PROJECT_ROLES, RANK, require_project
from .auth import Principal, current_principal, hash_token, new_token, require

router = APIRouter(prefix="/v1")
ProjectRole = Literal["data_only_viewer", "viewer", "editor", "manager", "owner"]
InviteRole = Literal["data_only_viewer", "viewer", "editor", "manager"]
GlobalRole = Literal["contributor", "reviewer", "editor", "admin"]


def _code_hash(code: str) -> str:
    return hashlib.sha256(code.encode()).hexdigest()


class MemberIn(BaseModel):
    contributor_id: str
    role: ProjectRole


class MemberPatch(BaseModel):
    role: ProjectRole


class InviteIn(BaseModel):
    role: InviteRole = "viewer"
    expires_in_days: int | None = Field(14, ge=1, le=365)
    max_uses: int | None = Field(None, ge=1, le=1000)
    note: str | None = Field(None, max_length=200)


class AcceptIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=80, description="Display name for a new account")
    device: str | None = Field(None, max_length=80)


class ContributorIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=80)
    email: str | None = Field(None, max_length=200)
    role: GlobalRole = "contributor"


class ContributorPatch(BaseModel):
    role: GlobalRole | None = None
    disabled: bool | None = None
    name: str | None = Field(None, min_length=1, max_length=80)


class ReadIn(BaseModel):
    ids: list[str] | None = None
    all: bool = False
    unread: bool = False   # mark the given ids unread again


# ---- members --------------------------------------------------------------------------
@router.get("/projects/{project_id}/members")
async def members(project_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        await require_project(conn, p, project_id, "viewer")   # data-only viewers don't see who works on it
        rows = await (await conn.execute(
            "SELECT m.contributor_id, m.role, m.created_at, c.display_name FROM capture.project_members m"
            " JOIN capture.contributors c ON c.id = m.contributor_id WHERE m.project_id = %s AND c.disabled_at IS NULL"
            " ORDER BY array_position(%s::text[], m.role) DESC, c.display_name", (project_id, PROJECT_ROLES))).fetchall()
    return {"members": [{"id": str(r["contributor_id"]), "name": r["display_name"], "role": r["role"],
                         "since": r["created_at"]} for r in rows]}


async def _owner_count(conn, project_id) -> int:
    return (await (await conn.execute(
        "SELECT count(*) AS n FROM capture.project_members WHERE project_id = %s AND role = 'owner'",
        (project_id,))).fetchone())["n"]


@router.post("/projects/{project_id}/members", status_code=201)
async def add_member(project_id: str, body: MemberIn, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        await require_project(conn, p, project_id, "owner")
        c = await (await conn.execute("SELECT id FROM capture.contributors WHERE id = %s AND disabled_at IS NULL",
                                      (body.contributor_id,))).fetchone()
        if not c:
            raise HTTPException(404, "person not found")
        await conn.execute(
            "INSERT INTO capture.project_members (project_id, contributor_id, role, added_by) VALUES (%s,%s,%s,%s)"
            " ON CONFLICT (project_id, contributor_id) DO UPDATE SET role = EXCLUDED.role",
            (project_id, body.contributor_id, body.role, p.contributor_id))
    return {"ok": True}


@router.patch("/projects/{project_id}/members/{contributor_id}")
async def change_member(project_id: str, contributor_id: str, body: MemberPatch, request: Request,
                        p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            await require_project(conn, p, project_id, "owner")
            cur = await (await conn.execute("SELECT role FROM capture.project_members WHERE project_id = %s"
                                            " AND contributor_id = %s FOR UPDATE", (project_id, contributor_id))).fetchone()
            if not cur:
                raise HTTPException(404, "not a member")
            if cur["role"] == "owner" and body.role != "owner" and await _owner_count(conn, project_id) <= 1:
                raise HTTPException(409, "a project needs at least one owner")
            await conn.execute("UPDATE capture.project_members SET role = %s WHERE project_id = %s AND contributor_id = %s",
                               (body.role, project_id, contributor_id))
    return {"ok": True}


@router.delete("/projects/{project_id}/members/{contributor_id}", status_code=204)
async def remove_member(project_id: str, contributor_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            leaving_self = contributor_id == p.contributor_id
            if not leaving_self:
                await require_project(conn, p, project_id, "owner")
            cur = await (await conn.execute("SELECT role FROM capture.project_members WHERE project_id = %s"
                                            " AND contributor_id = %s FOR UPDATE", (project_id, contributor_id))).fetchone()
            if not cur:
                raise HTTPException(404, "not a member")
            if cur["role"] == "owner" and await _owner_count(conn, project_id) <= 1:
                raise HTTPException(409, "a project needs at least one owner")
            await conn.execute("DELETE FROM capture.project_members WHERE project_id = %s AND contributor_id = %s",
                               (project_id, contributor_id))
            # Removed people stop following the project's incidents.
            await conn.execute("DELETE FROM capture.subscriptions s USING capture.incidents i"
                               " WHERE s.incident_id = i.id AND i.project_id = %s AND s.contributor_id = %s",
                               (project_id, contributor_id))


# ---- invites ----------------------------------------------------------------------------
def _invite_json(r: dict) -> dict:
    now = datetime.now(timezone.utc)
    active = (r["revoked_at"] is None and (r["expires_at"] is None or r["expires_at"] > now)
              and (r["max_uses"] is None or r["uses"] < r["max_uses"]))
    return {"id": str(r["id"]), "role": r["role"], "note": r["note"], "uses": r["uses"], "max_uses": r["max_uses"],
            "expires_at": r["expires_at"], "revoked": r["revoked_at"] is not None, "active": active,
            "created_at": r["created_at"]}


@router.get("/projects/{project_id}/invites")
async def list_invites(project_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        await require_project(conn, p, project_id, "owner")
        rows = await (await conn.execute("SELECT * FROM capture.project_invites WHERE project_id = %s"
                                         " ORDER BY created_at DESC", (project_id,))).fetchall()
    return {"invites": [_invite_json(r) for r in rows]}


@router.post("/projects/{project_id}/invites", status_code=201)
async def create_invite(project_id: str, body: InviteIn, request: Request, p: Principal = Depends(current_principal)):
    code = secrets.token_urlsafe(18)
    expires = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days) if body.expires_in_days else None
    async with request.app.state.pool.connection() as conn:
        await require_project(conn, p, project_id, "owner")
        r = await (await conn.execute(
            "INSERT INTO capture.project_invites (project_id, code_sha256, role, note, max_uses, expires_at, created_by)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
            (project_id, _code_hash(code), body.role, body.note, body.max_uses, expires, p.contributor_id))).fetchone()
    # The code is returned once; the client builds the link (#/invite/<code>).
    return {**_invite_json(r), "code": code}


@router.delete("/projects/{project_id}/invites/{invite_id}", status_code=204)
async def revoke_invite(project_id: str, invite_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        await require_project(conn, p, project_id, "owner")
        await conn.execute("UPDATE capture.project_invites SET revoked_at = now() WHERE id = %s AND project_id = %s"
                           " AND revoked_at IS NULL", (invite_id, project_id))


async def _find_invite(conn, code: str, lock: bool = False) -> dict:
    r = await (await conn.execute(
        "SELECT i.*, p.name AS project_name, p.code AS project_code, p.color, p.archived FROM capture.project_invites i"
        " JOIN capture.projects p ON p.id = i.project_id WHERE i.code_sha256 = %s" + (" FOR UPDATE OF i" if lock else ""),
        (_code_hash(code),))).fetchone()
    if not r or not _invite_json(r)["active"] or r["archived"]:
        raise HTTPException(404, "this invite link is invalid, expired or used up")
    return r


@router.get("/invites/{code}")
async def invite_info(code: str, request: Request):
    """Public: what an invite link grants, so the page can say "You're invited to SH · Sông Hồng as Editor"."""
    async with request.app.state.pool.connection() as conn:
        r = await _find_invite(conn, code)
    return {"project": {"name": r["project_name"], "code": r["project_code"], "color": r["color"]}, "role": r["role"],
            "expires_at": r["expires_at"]}


@router.post("/invites/{code}/accept")
async def accept_invite(code: str, body: AcceptIn, request: Request):
    """Join with the current account (Bearer token), or create one (body.name) and get its token once."""
    principal = None
    if request.headers.get("authorization"):
        principal = await current_principal(request)
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            inv = await _find_invite(conn, code, lock=True)
            token = None
            if principal:
                cid = principal.contributor_id
            else:
                if not body.name:
                    raise HTTPException(422, "choose a display name")
                c = await (await conn.execute(
                    "INSERT INTO capture.contributors (display_name, role) VALUES (%s, 'contributor') RETURNING id",
                    (body.name.strip(),))).fetchone()
                cid = str(c["id"])
                token = new_token()
                await conn.execute("INSERT INTO capture.tokens (contributor_id, label, token_sha256) VALUES (%s,%s,%s)",
                                   (cid, (body.device or "invite link")[:80], hash_token(token)))
            cur = await (await conn.execute("SELECT role FROM capture.project_members WHERE project_id = %s"
                                            " AND contributor_id = %s", (inv["project_id"], cid))).fetchone()
            if not cur:
                await conn.execute("INSERT INTO capture.project_members (project_id, contributor_id, role, added_by)"
                                   " VALUES (%s,%s,%s,%s)", (inv["project_id"], cid, inv["role"], inv["created_by"]))
            elif RANK[inv["role"]] > RANK[cur["role"]]:
                # An invite never lowers an existing role, only raises it.
                await conn.execute("UPDATE capture.project_members SET role = %s WHERE project_id = %s AND contributor_id = %s",
                                   (inv["role"], inv["project_id"], cid))
            await conn.execute("UPDATE capture.project_invites SET uses = uses + 1 WHERE id = %s", (inv["id"],))
    return {"project_id": str(inv["project_id"]), "role": inv["role"], "token": token}


# ---- people directory & admin -------------------------------------------------------------
@router.get("/contributors")
async def contributors(request: Request, project_id: str | None = None, p: Principal = Depends(current_principal)):
    """With `project_id`: that project's members who can be assigned (viewer+ of the project may ask).
    Without: everyone, for owners adding existing people to a project (project owners and admins only)."""
    async with request.app.state.pool.connection() as conn:
        if project_id:
            await require_project(conn, p, project_id, "viewer")
            rows = await (await conn.execute(
                "SELECT c.id, c.display_name, m.role FROM capture.project_members m JOIN capture.contributors c"
                " ON c.id = m.contributor_id WHERE m.project_id = %s AND c.disabled_at IS NULL"
                " AND m.role <> 'data_only_viewer' ORDER BY c.display_name", (project_id,))).fetchall()
        else:
            owner = p.role == "admin" or await (await conn.execute(
                "SELECT 1 FROM capture.project_members WHERE contributor_id = %s AND role = 'owner' LIMIT 1",
                (p.contributor_id,))).fetchone()
            if not owner:
                raise HTTPException(403, "only project owners and admins can list everyone")
            rows = await (await conn.execute("SELECT id, display_name, role FROM capture.contributors"
                                             " WHERE disabled_at IS NULL ORDER BY display_name")).fetchall()
    return {"contributors": [{"id": str(r["id"]), "name": r["display_name"], "role": r["role"]} for r in rows]}


@router.get("/admin/contributors")
async def admin_list(request: Request, p: Principal = Depends(require("admin"))):
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT c.*, (SELECT count(*) FROM capture.tokens t WHERE t.contributor_id = c.id AND t.revoked_at IS NULL)"
            " AS tokens, (SELECT max(t.last_used_at) FROM capture.tokens t WHERE t.contributor_id = c.id) AS last_seen,"
            " (SELECT coalesce(json_agg(json_build_object('code', pr.code, 'role', m.role) ORDER BY pr.code), '[]')"
            "   FROM capture.project_members m JOIN capture.projects pr ON pr.id = m.project_id"
            "   WHERE m.contributor_id = c.id) AS projects"
            " FROM capture.contributors c ORDER BY c.disabled_at NULLS FIRST, c.display_name")).fetchall()
    return {"contributors": [{"id": str(r["id"]), "name": r["display_name"], "email": r["email"], "role": r["role"],
                              "disabled": r["disabled_at"] is not None, "tokens": r["tokens"], "last_seen": r["last_seen"],
                              "projects": r["projects"], "created_at": r["created_at"]} for r in rows]}


@router.post("/admin/contributors", status_code=201)
async def admin_create(body: ContributorIn, request: Request, p: Principal = Depends(require("admin"))):
    token = new_token()
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            c = await (await conn.execute(
                "INSERT INTO capture.contributors (display_name, email, role) VALUES (%s,%s,%s) RETURNING id",
                (body.name.strip(), (body.email or "").strip() or None, body.role))).fetchone()
            await conn.execute("INSERT INTO capture.tokens (contributor_id, label, token_sha256) VALUES (%s,%s,%s)",
                               (c["id"], "created by admin", hash_token(token)))
    return {"id": str(c["id"]), "token": token}


@router.patch("/admin/contributors/{cid}")
async def admin_update(cid: str, body: ContributorPatch, request: Request, p: Principal = Depends(require("admin"))):
    if cid == p.contributor_id and (body.disabled or (body.role and body.role != "admin")):
        raise HTTPException(409, "you can't disable yourself or remove your own admin role")
    async with request.app.state.pool.connection() as conn:
        if body.role:
            await conn.execute("UPDATE capture.contributors SET role = %s WHERE id = %s", (body.role, cid))
        if body.name:
            await conn.execute("UPDATE capture.contributors SET display_name = %s WHERE id = %s", (body.name.strip(), cid))
        if body.disabled is not None:
            await conn.execute("UPDATE capture.contributors SET disabled_at = CASE WHEN %s THEN now() END WHERE id = %s",
                               (body.disabled, cid))
    return {"ok": True}


@router.post("/admin/contributors/{cid}/token", status_code=201)
async def admin_new_token(cid: str, request: Request, p: Principal = Depends(require("admin"))):
    """Issue a fresh token (e.g. a lost phone). Shown once."""
    token = new_token()
    async with request.app.state.pool.connection() as conn:
        await conn.execute("INSERT INTO capture.tokens (contributor_id, label, token_sha256) VALUES (%s,%s,%s)",
                           (cid, "issued by admin", hash_token(token)))
    return {"token": token}


@router.post("/admin/contributors/{cid}/revoke-tokens")
async def admin_revoke(cid: str, request: Request, p: Principal = Depends(require("admin"))):
    async with request.app.state.pool.connection() as conn:
        cur = await conn.execute("UPDATE capture.tokens SET revoked_at = now() WHERE contributor_id = %s"
                                 " AND revoked_at IS NULL AND id::text <> %s", (cid, p.token_id))
    return {"revoked": cur.rowcount}


# ---- notifications --------------------------------------------------------------------------
@router.get("/notifications")
async def notifications(request: Request, unread_only: bool = False, limit: int = 50,
                        p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT n.id, n.reason, n.read_at, n.created_at, u.kind, u.field, u.new_value, u.body, u.item_id,"
            " c.display_name AS actor, i.id AS incident_id, i.description, p.code || '-' || i.number AS slug, p.color"
            " FROM capture.notifications n JOIN capture.updates u ON u.id = n.update_id"
            " JOIN capture.incidents i ON i.id = u.incident_id JOIN capture.projects p ON p.id = i.project_id"
            " LEFT JOIN capture.contributors c ON c.id = u.contributor_id"
            " WHERE n.contributor_id = %s" + (" AND n.read_at IS NULL" if unread_only else "") +
            " ORDER BY n.created_at DESC LIMIT %s", (p.contributor_id, min(max(limit, 1), 200)))).fetchall()
        unread = (await (await conn.execute("SELECT count(*) AS n FROM capture.notifications WHERE contributor_id = %s"
                                            " AND read_at IS NULL", (p.contributor_id,))).fetchone())["n"]
    return {"unread": unread, "notifications": [
        {"id": str(r["id"]), "reason": r["reason"], "read": r["read_at"] is not None, "created_at": r["created_at"],
         "kind": r["kind"], "field": r["field"], "verdict": (r["new_value"] or {}).get("verdict") if r["kind"] == "capture" else None,
         "body": (r["body"] or "")[:280], "actor": r["actor"], "item_id": str(r["item_id"]) if r["item_id"] else None,
         "incident": {"id": str(r["incident_id"]), "slug": r["slug"], "description": r["description"], "color": r["color"]}}
        for r in rows]}


@router.get("/notifications/unread_count")
async def unread_count(request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        n = (await (await conn.execute("SELECT count(*) AS n FROM capture.notifications WHERE contributor_id = %s"
                                       " AND read_at IS NULL", (p.contributor_id,))).fetchone())["n"]
    return {"unread": n}


@router.post("/notifications/read")
async def mark_read(body: ReadIn, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        if body.all:
            await conn.execute("UPDATE capture.notifications SET read_at = now() WHERE contributor_id = %s"
                               " AND read_at IS NULL", (p.contributor_id,))
        elif body.ids:
            await conn.execute("UPDATE capture.notifications SET read_at = CASE WHEN %s THEN NULL ELSE now() END"
                               " WHERE contributor_id = %s AND id = ANY(%s::uuid[])",
                               (body.unread, p.contributor_id, body.ids))
    return {"ok": True}


@router.get("/me/subscriptions")
async def my_subscriptions(request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT i.id, p.code || '-' || i.number AS slug, i.description, i.status, p.color FROM capture.subscriptions s"
            " JOIN capture.incidents i ON i.id = s.incident_id JOIN capture.projects p ON p.id = i.project_id"
            " WHERE s.contributor_id = %s AND NOT i.deleted ORDER BY i.updated_at DESC", (p.contributor_id,))).fetchall()
    return {"incidents": [{"id": str(r["id"]), "slug": r["slug"], "description": r["description"], "status": r["status"],
                           "color": r["color"]} for r in rows]}

"""Workspace API: projects, incidents, their feed, subscriptions, bulk import. Modelled on Atlos.

Who may do what is decided per project (access.py): data-only viewer < viewer < editor < manager < owner.
Creating a project needs the instance role `editor` or `admin` (Atlos "trusted"); its creator becomes owner.
"""

import csv
import io
import re
import secrets
from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from . import importer
from .access import at_least, project_role, require_project, visible_projects_sql
from .auth import Principal, current_principal, require
from .inbox_core import ITEM_SELECT, add_update, item_json_for, save_link
from .notify import subscribe
from .signing import artifact_url

router = APIRouter(prefix="/v1")

STATUSES = ["to_do", "in_progress", "help_needed", "ready_for_review", "completed", "cancelled"]
PRIVILEGED_STATUSES = {"completed", "cancelled"}
SENSITIVE = ["not_sensitive", "personal_info", "graphic_violence", "deleted_by_source", "deceptive"]
# Incident fields whose changes are recorded in the feed.
TRACKED = ("description", "status", "sensitive", "tags", "event_date", "place", "lat", "lng", "geo_precision",
           "assignees", "custom")


# ---- models ---------------------------------------------------------------
class AttributeDef(BaseModel):
    id: str | None = Field(None, max_length=20)
    name: str = Field(..., min_length=1, max_length=80)
    type: Literal["text", "select", "multi_select", "date"] = "text"
    options: list[str] = Field(default_factory=list, max_length=100)
    description: str | None = Field(None, max_length=500)


class ProjectIn(BaseModel):
    code: str | None = Field(None, max_length=6)
    name: str | None = Field(None, min_length=1, max_length=120)
    description: str | None = Field(None, max_length=4000)
    color: str | None = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    tag_options: list[str] | None = Field(None, max_length=200)
    attributes: list[AttributeDef] | None = Field(None, max_length=40)
    wayback_enabled: bool | None = None
    archived: bool | None = None


class IncidentIn(BaseModel):
    project_id: str | None = None
    description: str | None = Field(None, min_length=1, max_length=1000)
    status: Literal[tuple(STATUSES)] | None = None  # type: ignore[valid-type]
    sensitive: list[Literal[tuple(SENSITIVE)]] | None = None  # type: ignore[valid-type]
    tags: list[str] | None = Field(None, max_length=50)
    event_date: date | None = None
    place: str | None = Field(None, max_length=300)
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    geo_precision: Literal["exact", "vicinity", "locality"] | None = None
    assignees: list[str] | None = Field(None, max_length=20)
    custom: dict | None = None
    deleted: bool | None = None
    reason: str | None = Field(None, max_length=2000, description="Optional explanation, shown in the feed")
    urls: list[str] | None = Field(None, max_length=50, description="Source material to save with a new incident")


class CommentIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=10000)


class MaterialIn(BaseModel):
    url: str | None = Field(None, max_length=4000)
    text: str | None = Field(None, max_length=10000)
    note: str | None = Field(None, max_length=5000)
    new_version: bool = False


class ImportIn(BaseModel):
    csv: str = Field(..., max_length=2_000_000)
    commit: bool = False


# ---- helpers ----------------------------------------------------------------
def _clean_tags(tags: list[str]) -> list[str]:
    out = []
    for t in tags:
        t = re.sub(r"\s+", " ", t).strip()[:60]
        if t and t not in out:
            out.append(t)
    return out


def _project_json(r: dict, my_role: str | None = None) -> dict:
    return {"id": str(r["id"]), "code": r["code"], "name": r["name"], "description": r["description"],
            "color": r["color"], "tag_options": r["tag_options"], "attributes": r["attributes"],
            "wayback_enabled": r["wayback_enabled"], "archived": r["archived"], "created_at": r["created_at"],
            "updated_at": r["updated_at"], "incident_count": r.get("incident_count"),
            "open_count": r.get("open_count"), "my_role": my_role or r.get("my_role")}


def _normalise_attrs(defs: list[AttributeDef]) -> list[dict]:
    out, seen = [], set()
    for d in defs:
        a = d.model_dump()
        a["id"] = a["id"] or secrets.token_hex(4)
        if a["id"] in seen:
            raise HTTPException(422, f"duplicate attribute id {a['id']}")
        seen.add(a["id"])
        a["options"] = _clean_tags(a["options"]) if a["type"] in ("select", "multi_select") else []
        out.append(a)
    return out


def _validate_custom(custom: dict, defs: list[dict]) -> dict:
    by_id = {d["id"]: d for d in defs}
    out = {}
    for k, v in custom.items():
        d = by_id.get(k)
        if d is None:
            raise HTTPException(422, f"unknown attribute {k}")
        if v in (None, "", []):
            continue
        if d["type"] == "select" and (not isinstance(v, str) or (d["options"] and v not in d["options"])):
            raise HTTPException(422, f"{d['name']}: not one of the options")
        if d["type"] == "multi_select":
            if not isinstance(v, list) or (d["options"] and any(x not in d["options"] for x in v)):
                raise HTTPException(422, f"{d['name']}: not a list of the options")
        if d["type"] == "date":
            try:
                date.fromisoformat(str(v))
            except ValueError:
                raise HTTPException(422, f"{d['name']}: not a date (YYYY-MM-DD)") from None
        if d["type"] == "text" and (not isinstance(v, str) or len(v) > 4000):
            raise HTTPException(422, f"{d['name']}: text too long")
        out[k] = v
    return out


INCIDENT_SELECT = """
SELECT i.*, p.code, p.name AS project_name, p.color, p.archived AS project_archived, p.attributes AS project_attributes,
       c.display_name AS created_by_name,
       (SELECT count(*) FROM capture.item_incidents ii WHERE ii.incident_id = i.id) AS material_count,
       (SELECT a.id FROM capture.item_incidents ii JOIN capture.items it ON it.id = ii.item_id
          JOIN capture.artifacts a ON a.capture_id = it.latest_capture_id
         WHERE ii.incident_id = i.id AND a.role = 'primary' AND a.kind IN ('image', 'screenshot')
         ORDER BY (a.kind = 'image') DESC, ii.added_at LIMIT 1) AS thumb_artifact_id
  FROM capture.incidents i
  JOIN capture.projects p ON p.id = i.project_id
  LEFT JOIN capture.contributors c ON c.id = i.created_by
"""


async def _names(conn, ids: list) -> dict[str, str]:
    if not ids:
        return {}
    rows = await (await conn.execute("SELECT id, display_name FROM capture.contributors WHERE id = ANY(%s::uuid[])",
                                     ([str(i) for i in ids],))).fetchall()
    return {str(r["id"]): r["display_name"] for r in rows}


def _incident_json(r: dict, names: dict[str, str], role: str) -> dict:
    data_only = role == "data_only_viewer"   # Atlos: no names of the people working on it
    return {
        "id": str(r["id"]), "slug": f"{r['code']}-{r['number']}", "number": r["number"],
        "project": {"id": str(r["project_id"]), "code": r["code"], "name": r["project_name"], "color": r["color"],
                    "archived": r["project_archived"]},
        "description": r["description"], "status": r["status"], "sensitive": r["sensitive"], "tags": r["tags"],
        "event_date": r["event_date"], "place": r["place"], "lat": r["lat"], "lng": r["lng"],
        "geo_precision": r["geo_precision"],
        "assignees": [] if data_only else [{"id": str(a), "name": names.get(str(a), "?")} for a in r["assignees"]],
        "custom": r["custom"], "deleted": r["deleted"], "created_at": r["created_at"], "updated_at": r["updated_at"],
        "created_by": None if data_only else {"id": str(r["created_by"]) if r["created_by"] else None,
                                              "name": r.get("created_by_name")},
        "material_count": r.get("material_count"),
        "thumbnail_url": artifact_url(r["thumb_artifact_id"]) if r.get("thumb_artifact_id") else None,
        "my_role": role,
    }


async def _get_incident(conn, incident_id: str, p: Principal, minimum: str = "data_only_viewer") -> tuple[dict, str]:
    r = await (await conn.execute(INCIDENT_SELECT + " WHERE i.id = %s", (incident_id,))).fetchone()
    if not r:
        raise HTTPException(404, "incident not found")
    try:
        role = await require_project(conn, p, r["project_id"], minimum)
    except HTTPException as e:
        raise HTTPException(404 if e.status_code == 404 else e.status_code,
                            "incident not found" if e.status_code == 404 else e.detail) from None
    if r["deleted"] and not at_least(role, "manager"):
        raise HTTPException(404, "incident not found")
    return r, role


# ---- projects ----------------------------------------------------------------
@router.get("/projects")
async def list_projects(request: Request, include_archived: bool = False, p: Principal = Depends(current_principal)):
    cond, args = visible_projects_sql(p)
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT pr.*, (SELECT role FROM capture.project_members m WHERE m.project_id = pr.id AND m.contributor_id = %s)"
            " AS my_role, count(i.id) FILTER (WHERE NOT i.deleted) AS incident_count,"
            " count(i.id) FILTER (WHERE NOT i.deleted AND i.status NOT IN ('completed','cancelled')) AS open_count"
            " FROM capture.projects pr LEFT JOIN capture.incidents i ON i.project_id = pr.id"
            f" WHERE {cond}" + ("" if include_archived else " AND NOT pr.archived") +
            " GROUP BY pr.id ORDER BY pr.archived, pr.name", (p.contributor_id, *args))).fetchall()
    return {"projects": [_project_json(r, "owner" if p.role == "admin" else r["my_role"]) for r in rows]}


@router.post("/projects", status_code=201)
async def create_project(body: ProjectIn, request: Request, p: Principal = Depends(require("editor"))):
    if not body.name or not body.code:
        raise HTTPException(422, "name and code are required")
    code = body.code.upper()
    if not re.fullmatch(r"[A-Z0-9]{2,6}", code):
        raise HTTPException(422, "code must be 2-6 letters or digits")
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            if await (await conn.execute("SELECT 1 FROM capture.projects WHERE code = %s", (code,))).fetchone():
                raise HTTPException(409, f"code {code} is already used")
            r = await (await conn.execute(
                "INSERT INTO capture.projects (code, name, description, color, tag_options, attributes, wayback_enabled,"
                " created_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING *",
                (code, body.name, body.description, body.color or "#2563eb", _clean_tags(body.tag_options or []),
                 Jsonb(_normalise_attrs(body.attributes or [])), bool(body.wayback_enabled), p.contributor_id))).fetchone()
            await conn.execute("INSERT INTO capture.project_members (project_id, contributor_id, role, added_by)"
                               " VALUES (%s, %s, 'owner', %s)", (r["id"], p.contributor_id, p.contributor_id))
    return _project_json(r, "owner")


@router.get("/projects/{project_id}")
async def get_project(project_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        role = await require_project(conn, p, project_id)
        r = await (await conn.execute("SELECT * FROM capture.projects WHERE id = %s", (project_id,))).fetchone()
    if not r:
        raise HTTPException(404, "project not found")
    return _project_json(r, role)


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, body: ProjectIn, request: Request, p: Principal = Depends(current_principal)):
    changes = body.model_dump(exclude_unset=True)
    changes.pop("code", None)  # the code is part of every incident id; it never changes
    async with request.app.state.pool.connection() as conn:
        role = await require_project(conn, p, project_id, "manager")
        if "archived" in changes and not at_least(role, "owner"):
            raise HTTPException(403, "only owners can archive a project")
        if "tag_options" in changes:
            changes["tag_options"] = _clean_tags(changes["tag_options"] or [])
        if "attributes" in changes:
            changes["attributes"] = Jsonb(_normalise_attrs(body.attributes or []))
        if changes:
            cols = ", ".join(f"{k} = %s" for k in changes)
            await conn.execute(f"UPDATE capture.projects SET {cols}, updated_at = now() WHERE id = %s",
                               (*changes.values(), project_id))
        r = await (await conn.execute("SELECT * FROM capture.projects WHERE id = %s", (project_id,))).fetchone()
    return _project_json(r, role)


# ---- incidents ----------------------------------------------------------------
@router.get("/incidents")
async def list_incidents(request: Request, p: Principal = Depends(current_principal),
                         project_id: str | None = None, status: str | None = None, tag: str | None = None,
                         assignee: str | None = None, sensitive: str | None = None, q: str | None = None,
                         has_location: bool = False, sort: Literal["updated", "created", "number"] = "updated",
                         limit: int = Query(60, ge=1, le=1000), offset: int = Query(0, ge=0)):
    cond, cargs = visible_projects_sql(p, "p")
    where, args = ["NOT i.deleted", "NOT p.archived" if not project_id else "TRUE", cond], list(cargs)
    for col, val in (("i.project_id = %s", project_id), ("i.status = %s", status),
                     ("%s = ANY(i.tags)", tag), ("%s::uuid = ANY(i.assignees)", assignee),
                     ("%s = ANY(i.sensitive)", sensitive)):
        if val:
            where.append(col)
            args.append(val)
    if has_location:
        where.append("i.lat IS NOT NULL AND i.lng IS NOT NULL")
    if q:
        where.append("(i.description ILIKE %s OR i.place ILIKE %s OR (p.code || '-' || i.number) ILIKE %s"
                     " OR EXISTS (SELECT 1 FROM capture.item_incidents ii JOIN capture.items it ON it.id = ii.item_id"
                     "            WHERE ii.incident_id = i.id"
                     "            AND (it.canonical_url ILIKE %s OR it.title ILIKE %s)))")
        args += [f"%{q}%"] * 5
    order = {"updated": "i.updated_at DESC", "created": "i.created_at DESC", "number": "p.code, i.number DESC"}[sort]
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            INCIDENT_SELECT + " WHERE " + " AND ".join(where) + f" ORDER BY {order} LIMIT %s OFFSET %s",
            (*args, limit, offset))).fetchall()
        roles = {}
        for pid in {r["project_id"] for r in rows}:
            roles[pid] = await project_role(conn, p, pid)
        names = await _names(conn, list({a for r in rows for a in r["assignees"]}))
    return {"incidents": [_incident_json(r, names, roles[r["project_id"]]) for r in rows]}


async def _apply_incident_changes(conn, r: dict, body: IncidentIn, p: Principal, role: str) -> int:
    """Write changed fields and one feed entry per change. Returns how many fields changed."""
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items() if k in TRACKED or k == "deleted"}
    if "tags" in changes:
        changes["tags"] = _clean_tags(changes["tags"] or [])
    if "sensitive" in changes:
        s = list(dict.fromkeys(changes["sensitive"] or [])) or ["not_sensitive"]
        changes["sensitive"] = [x for x in s if x != "not_sensitive"] or ["not_sensitive"]
    if "custom" in changes:
        changes["custom"] = {**r["custom"], **_validate_custom(changes["custom"] or {}, r["project_attributes"])}
        changes["custom"] = {k: v for k, v in changes["custom"].items() if v not in (None, "", [])}
    if "assignees" in changes:
        changes["assignees"] = list(dict.fromkeys(changes["assignees"] or []))
        if changes["assignees"]:
            ok = await (await conn.execute(
                "SELECT count(*) AS n FROM capture.project_members WHERE project_id = %s AND contributor_id = ANY(%s::uuid[])"
                " AND role <> 'data_only_viewer'", (r["project_id"], changes["assignees"]))).fetchone()
            if ok["n"] != len(changes["assignees"]):
                raise HTTPException(422, "assignees must be members of the project")
    # Atlos: completed/cancelled incidents, and setting those statuses, are for managers.
    if r["status"] in PRIVILEGED_STATUSES and not at_least(role, "manager"):
        raise HTTPException(403, "only managers can edit a completed or cancelled incident")
    if changes.get("status") in PRIVILEGED_STATUSES and changes["status"] != r["status"] and not at_least(role, "manager"):
        raise HTTPException(403, "only managers can mark an incident completed or cancelled")
    if "deleted" in changes and not at_least(role, "manager"):
        raise HTTPException(403, "only managers can delete incidents")

    def norm(v):
        return [str(x) for x in v] if isinstance(v, list) else (v.isoformat() if isinstance(v, date) else v)

    changed = {k: v for k, v in changes.items() if norm(v) != norm(r[k])}
    if not changed:
        return 0
    cols = ", ".join(f"{k} = %s" for k in changed)
    vals = [Jsonb(v) if k == "custom" else v for k, v in changed.items()]
    await conn.execute(f"UPDATE capture.incidents SET {cols}, updated_at = now() WHERE id = %s", (*vals, r["id"]))
    for k, v in changed.items():
        await add_update(conn, incident_id=r["id"], kind="attribute", p=p, field=k, old=norm(r[k]), new=norm(v),
                         body=body.reason)
    return len(changed)


async def _create_incident(conn, p: Principal, body: IncidentIn, role: str, created_note: str | None = None,
                           rate_limit: bool = True) -> tuple[str, list[str]]:
    proj = await (await conn.execute(
        "UPDATE capture.projects SET next_number = next_number + 1 WHERE id = %s AND NOT archived"
        " RETURNING next_number - 1 AS number", (body.project_id,))).fetchone()
    if not proj:
        raise HTTPException(409, "the project is archived")
    row = await (await conn.execute(
        "INSERT INTO capture.incidents (project_id, number, description, created_by) VALUES (%s,%s,%s,%s)"
        " RETURNING id", (body.project_id, proj["number"], body.description, p.contributor_id))).fetchone()
    await add_update(conn, incident_id=row["id"], kind="created", p=p, body=created_note or body.reason)
    # The remaining attributes are set like an edit, but their feed entries are folded into "created".
    fields = {k for k in body.model_fields_set if k in TRACKED and k != "description"}
    if fields:
        r, _ = await _get_incident(conn, row["id"], p)
        await _apply_incident_changes(conn, r, IncidentIn(**{k: getattr(body, k) for k in fields}), p, role)
        await conn.execute("DELETE FROM capture.updates WHERE incident_id = %s AND kind = 'attribute'", (row["id"],))
    saved = []
    for u in body.urls or []:
        if u.strip():
            _, res = await save_link(conn, p, url=None, text=u, client="web", incident_id=str(row["id"]),
                                     rate_limit=rate_limit)
            saved.append(res["item"]["id"])
    return str(row["id"]), saved


@router.post("/incidents", status_code=201)
async def create_incident(body: IncidentIn, request: Request, p: Principal = Depends(current_principal)):
    if not body.project_id or not body.description:
        raise HTTPException(422, "project_id and description are required")
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            role = await require_project(conn, p, body.project_id, "editor")
            if body.status in PRIVILEGED_STATUSES and not at_least(role, "manager"):
                raise HTTPException(403, "only managers can create a completed/cancelled incident")
            incident_id, saved = await _create_incident(conn, p, body, role)
            r, _ = await _get_incident(conn, incident_id, p)
            names = await _names(conn, r["assignees"])
    return {**_incident_json(r, names, role), "saved_items": saved}


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        r, role = await _get_incident(conn, incident_id, p)
        data_only = role == "data_only_viewer"
        items = await (await conn.execute(
            ITEM_SELECT + " JOIN capture.item_incidents link ON link.item_id = i.id WHERE link.incident_id = %s"
            " ORDER BY link.added_at", (incident_id,))).fetchall()
        thumbs = await (await conn.execute(
            "SELECT DISTINCT ON (it.id) it.id AS item_id, a.id FROM capture.item_incidents ii"
            " JOIN capture.items it ON it.id = ii.item_id JOIN capture.artifacts a ON a.capture_id = it.latest_capture_id"
            " WHERE ii.incident_id = %s AND a.kind IN ('image', 'screenshot')"
            " ORDER BY it.id, (a.role = 'primary') DESC, (a.label = 'embed') DESC, (a.kind = 'image') DESC",
            (incident_id,))).fetchall()
        feed = [] if data_only else await (await conn.execute(
            "SELECT u.*, c.display_name FROM capture.updates u LEFT JOIN capture.contributors c ON c.id = u.contributor_id"
            " WHERE u.incident_id = %s ORDER BY u.created_at", (incident_id,))).fetchall()
        names = {} if data_only else await _names(conn, list({*r["assignees"], *[
            x for u in feed if u["field"] == "assignees" for x in (u["old_value"] or []) + (u["new_value"] or [])]}))
        proj = await (await conn.execute("SELECT * FROM capture.projects WHERE id = %s", (r["project_id"],))).fetchone()
        sub = await (await conn.execute("SELECT 1 FROM capture.subscriptions WHERE contributor_id = %s AND incident_id = %s",
                                        (p.contributor_id, incident_id))).fetchone()
        copies = await (await conn.execute(
            "SELECT DISTINCT ON (e.item_id) e.item_id, e.state, e.copy_url, e.error FROM capture.external_copies e"
            " JOIN capture.item_incidents ii ON ii.item_id = e.item_id WHERE ii.incident_id = %s"
            " ORDER BY e.item_id, e.created_at DESC",
            (incident_id,))).fetchall()
        # Community submissions filed here (they may identify people: not for data-only viewers), and the
        # public version, if any.
        intake_rows = [] if data_only else await (await conn.execute(
            "SELECT k.id, k.kind, k.payload, k.received_at, s.name AS source_name FROM capture.intake k"
            " JOIN capture.sources s ON s.id = k.source_id WHERE k.incident_id = %s ORDER BY k.received_at",
            (incident_id,))).fetchall()
        intake_out = []
        for k in intake_rows:
            from .intake import intake_files   # intake imports workspace lazily; this keeps imports one-way at load
            pl = k["payload"] or {}
            intake_out.append({"id": str(k["id"]), "kind": k["kind"], "source": k["source_name"],
                               "received_at": k["received_at"],
                               "summary": (pl.get("title") or pl.get("text") or pl.get("note") or pl.get("url") or "")[:300],
                               "files": await intake_files(conn, k["id"])})
        pub = await (await conn.execute(
            "SELECT id, public_id, state, version, dirty, approved_by_manager IS NOT NULL AS m,"
            " approved_by_publisher IS NOT NULL AS pb FROM capture.publications WHERE incident_id = %s",
            (incident_id,))).fetchone()
    thumb_by_item = {str(t["item_id"]): artifact_url(t["id"]) for t in thumbs}
    copy_by_item = {str(c["item_id"]): {"state": c["state"], "url": c["copy_url"], "error": c["error"]} for c in copies}
    out = _incident_json(r, names, role)
    out["project"] = _project_json(proj, role)
    out["material"] = []
    for i in items:
        async with request.app.state.pool.connection() as conn:
            m = await item_json_for(conn, p, i)   # other incidents it's in: only those you can see
        if data_only:
            m["submitted_by"] = None
        out["material"].append({**m, "thumbnail_url": thumb_by_item.get(str(i["id"])),
                                "wayback": copy_by_item.get(str(i["id"]))})
    out["feed"] = [{"id": str(u["id"]), "kind": u["kind"], "field": u["field"], "old": u["old_value"],
                    "new": u["new_value"], "body": u["body"], "created_at": u["created_at"],
                    "item_id": str(u["item_id"]) if u["item_id"] else None,
                    "by": {"id": str(u["contributor_id"]) if u["contributor_id"] else None, "name": u["display_name"]}}
                   for u in feed]
    out["names"] = names
    out["subscribed"] = bool(sub)
    out["intake"] = intake_out
    out["publication"] = None if not pub else {
        "id": str(pub["id"]), "public_id": pub["public_id"], "state": pub["state"], "version": pub["version"],
        "dirty": pub["dirty"], "approvals": int(pub["m"]) + int(pub["pb"])}
    return out


@router.patch("/incidents/{incident_id}")
async def update_incident(incident_id: str, body: IncidentIn, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            r, role = await _get_incident(conn, incident_id, p, "editor")
            if r["project_archived"]:
                raise HTTPException(409, "the project is archived")
            await _apply_incident_changes(conn, r, body, p, role)
    return await get_incident(incident_id, request, p)


@router.post("/incidents/{incident_id}/comments", status_code=201)
async def comment(incident_id: str, body: CommentIn, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            r, _ = await _get_incident(conn, incident_id, p, "viewer")
            await add_update(conn, incident_id=r["id"], kind="comment", p=p, body=body.body.strip())
            await conn.execute("UPDATE capture.incidents SET updated_at = now() WHERE id = %s", (r["id"],))
    return {"ok": True}


@router.post("/incidents/{incident_id}/material")
async def add_material(incident_id: str, body: MaterialIn, request: Request, response: Response,
                       p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            await _get_incident(conn, incident_id, p, "editor")
            status, res = await save_link(conn, p, url=body.url, text=body.text, note=body.note, client="web",
                                          new_version=body.new_version, incident_id=incident_id)
            await conn.execute("UPDATE capture.incidents SET updated_at = now() WHERE id = %s", (incident_id,))
    response.status_code = status
    return res


@router.post("/incidents/{incident_id}/subscription", status_code=204)
async def follow(incident_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        await _get_incident(conn, incident_id, p, "viewer")
        await subscribe(conn, p.contributor_id, incident_id)


@router.delete("/incidents/{incident_id}/subscription", status_code=204)
async def unfollow(incident_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        await conn.execute("DELETE FROM capture.subscriptions WHERE contributor_id = %s AND incident_id = %s",
                           (p.contributor_id, incident_id))


# ---- export / import -------------------------------------------------------------
@router.get("/incidents.csv")
async def export_csv(request: Request, project_id: str, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        await require_project(conn, p, project_id, "viewer")
        proj = await (await conn.execute("SELECT * FROM capture.projects WHERE id = %s", (project_id,))).fetchone()
        rows = await (await conn.execute(
            INCIDENT_SELECT + " WHERE i.project_id = %s AND NOT i.deleted ORDER BY i.number", (project_id,))).fetchall()
        urls = await (await conn.execute(
            "SELECT ii.incident_id, string_agg(it.canonical_url, ' ' ORDER BY ii.added_at) AS urls"
            " FROM capture.item_incidents ii JOIN capture.items it ON it.id = ii.item_id"
            " JOIN capture.incidents i ON i.id = ii.incident_id WHERE i.project_id = %s"
            " GROUP BY ii.incident_id", (project_id,))).fetchall()
        names = await _names(conn, list({a for r in rows for a in r["assignees"]}))
    by_inc = {str(u["incident_id"]): u["urls"] for u in urls}
    attrs = proj["attributes"]
    buf = io.StringIO()
    w = csv.writer(buf)
    # Same column names the importer reads, so an export can be edited and imported elsewhere.
    w.writerow(["id", "description", "status", "sensitive", "tags", "date", "place", "lat", "lng", "precision",
                "assignees", *[a["name"] for a in attrs], "urls", "created_at", "updated_at"])
    for r in rows:
        custom = r["custom"]
        w.writerow([f"{r['code']}-{r['number']}", r["description"], r["status"], "|".join(r["sensitive"]),
                    "|".join(r["tags"]), r["event_date"] or "", r["place"] or "", r["lat"] or "", r["lng"] or "",
                    r["geo_precision"] or "", "|".join(names.get(str(a), "") for a in r["assignees"]),
                    *["|".join(v) if isinstance(v := custom.get(a["id"], ""), list) else v for a in attrs],
                    by_inc.get(str(r["id"]), ""), r["created_at"].isoformat(), r["updated_at"].isoformat()])
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{proj["code"]}-incidents.csv"'})


@router.post("/projects/{project_id}/import")
async def bulk_import(project_id: str, body: ImportIn, request: Request, p: Principal = Depends(current_principal)):
    """Atlos-style bulk import. `commit: false` validates and previews; `commit: true` creates every row,
    all or nothing, and only if no row has an error."""
    async with request.app.state.pool.connection() as conn:
        role = await require_project(conn, p, project_id, "manager")
        proj = await (await conn.execute("SELECT * FROM capture.projects WHERE id = %s", (project_id,))).fetchone()
        if proj["archived"]:
            raise HTTPException(409, "the project is archived")
        rows, file_errors = importer.parse(body.csv, proj["attributes"])
        bad = [r for r in rows if r["errors"]]
        result = {"rows": rows, "file_errors": file_errors, "valid": len(rows) - len(bad), "invalid": len(bad),
                  "created": []}
        blocking = [e for e in file_errors if not e.startswith(("unknown column", "only the first"))]
        if not body.commit or bad or blocking or not rows:
            return result
        async with conn.transaction():
            for r in rows:
                inc_in = IncidentIn(project_id=project_id, urls=r["urls"], **r["values"])
                incident_id, _ = await _create_incident(conn, p, inc_in, role, created_note=f"CSV import, row {r['line']}",
                                                        rate_limit=False)
                result["created"].append(incident_id)
    return result

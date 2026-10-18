"""Workspace API: projects, incidents, their feed. Modelled on Atlos.

Permissions (global roles for now; per-project membership is a later step):
  contributor  read everything here, create incidents, edit attributes, comment, add material
  reviewer     + set the privileged statuses (completed, cancelled), as Atlos reserves them for managers
  editor       + create/configure/archive projects, delete incidents
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

from .auth import Principal, current_principal, require
from .inbox_core import ITEM_SELECT, add_update, item_json, save_link
from .signing import artifact_url

router = APIRouter(prefix="/v1")

STATUSES = ["to_do", "in_progress", "help_needed", "ready_for_review", "completed", "cancelled"]
PRIVILEGED_STATUSES = {"completed", "cancelled"}
SENSITIVE = ["not_sensitive", "personal_info", "graphic_violence", "deleted_by_source", "deceptive"]
ATTR_TYPES = ("text", "select", "multi_select", "date")
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


# ---- helpers ----------------------------------------------------------------
def _clean_tags(tags: list[str]) -> list[str]:
    out = []
    for t in tags:
        t = re.sub(r"\s+", " ", t).strip()[:60]
        if t and t not in out:
            out.append(t)
    return out


def _project_json(r: dict) -> dict:
    return {"id": str(r["id"]), "code": r["code"], "name": r["name"], "description": r["description"],
            "color": r["color"], "tag_options": r["tag_options"], "attributes": r["attributes"],
            "archived": r["archived"], "created_at": r["created_at"], "updated_at": r["updated_at"],
            "incident_count": r.get("incident_count"), "open_count": r.get("open_count")}


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
       (SELECT count(*) FROM capture.items it WHERE it.incident_id = i.id) AS material_count,
       (SELECT a.id FROM capture.items it JOIN capture.artifacts a ON a.capture_id = it.latest_capture_id
         WHERE it.incident_id = i.id AND a.role = 'primary' AND a.kind IN ('image', 'screenshot')
         ORDER BY (a.kind = 'image') DESC, it.created_at LIMIT 1) AS thumb_artifact_id
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


def _incident_json(r: dict, names: dict[str, str]) -> dict:
    return {
        "id": str(r["id"]), "slug": f"{r['code']}-{r['number']}", "number": r["number"],
        "project": {"id": str(r["project_id"]), "code": r["code"], "name": r["project_name"], "color": r["color"],
                    "archived": r["project_archived"]},
        "description": r["description"], "status": r["status"], "sensitive": r["sensitive"], "tags": r["tags"],
        "event_date": r["event_date"], "place": r["place"], "lat": r["lat"], "lng": r["lng"],
        "geo_precision": r["geo_precision"],
        "assignees": [{"id": str(a), "name": names.get(str(a), "?")} for a in r["assignees"]],
        "custom": r["custom"], "deleted": r["deleted"], "created_at": r["created_at"], "updated_at": r["updated_at"],
        "created_by": {"id": str(r["created_by"]) if r["created_by"] else None, "name": r.get("created_by_name")},
        "material_count": r.get("material_count"),
        "thumbnail_url": artifact_url(r["thumb_artifact_id"]) if r.get("thumb_artifact_id") else None,
    }


async def _get_incident(conn, incident_id: str) -> dict:
    r = await (await conn.execute(INCIDENT_SELECT + " WHERE i.id = %s", (incident_id,))).fetchone()
    if not r:
        raise HTTPException(404, "incident not found")
    return r


# ---- contributors -------------------------------------------------------------
@router.get("/contributors")
async def contributors(request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT id, display_name, role FROM capture.contributors WHERE disabled_at IS NULL ORDER BY display_name")
        ).fetchall()
    return {"contributors": [{"id": str(r["id"]), "name": r["display_name"], "role": r["role"]} for r in rows]}


# ---- projects ----------------------------------------------------------------
@router.get("/projects")
async def list_projects(request: Request, include_archived: bool = False, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT pr.*, count(i.id) FILTER (WHERE NOT i.deleted) AS incident_count,"
            " count(i.id) FILTER (WHERE NOT i.deleted AND i.status NOT IN ('completed','cancelled')) AS open_count"
            " FROM capture.projects pr LEFT JOIN capture.incidents i ON i.project_id = pr.id"
            + ("" if include_archived else " WHERE NOT pr.archived") +
            " GROUP BY pr.id ORDER BY pr.archived, pr.name")).fetchall()
    return {"projects": [_project_json(r) for r in rows]}


@router.post("/projects", status_code=201)
async def create_project(body: ProjectIn, request: Request, p: Principal = Depends(require("editor"))):
    if not body.name or not body.code:
        raise HTTPException(422, "name and code are required")
    code = body.code.upper()
    if not re.fullmatch(r"[A-Z0-9]{2,6}", code):
        raise HTTPException(422, "code must be 2-6 letters or digits")
    async with request.app.state.pool.connection() as conn:
        if await (await conn.execute("SELECT 1 FROM capture.projects WHERE code = %s", (code,))).fetchone():
            raise HTTPException(409, f"code {code} is already used")
        r = await (await conn.execute(
            "INSERT INTO capture.projects (code, name, description, color, tag_options, attributes, created_by)"
            " VALUES (%s,%s,%s,%s,%s,%s,%s) RETURNING *",
            (code, body.name, body.description, body.color or "#2563eb", _clean_tags(body.tag_options or []),
             Jsonb(_normalise_attrs(body.attributes or [])), p.contributor_id))).fetchone()
    return _project_json(r)


@router.get("/projects/{project_id}")
async def get_project(project_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        r = await (await conn.execute("SELECT * FROM capture.projects WHERE id = %s", (project_id,))).fetchone()
    if not r:
        raise HTTPException(404, "project not found")
    return _project_json(r)


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, body: ProjectIn, request: Request, p: Principal = Depends(require("editor"))):
    changes = body.model_dump(exclude_unset=True)
    changes.pop("code", None)  # the code is part of every incident id; it never changes
    if "tag_options" in changes:
        changes["tag_options"] = _clean_tags(changes["tag_options"] or [])
    if "attributes" in changes:
        changes["attributes"] = Jsonb(_normalise_attrs(body.attributes or []))
    async with request.app.state.pool.connection() as conn:
        if changes:
            cols = ", ".join(f"{k} = %s" for k in changes)
            await conn.execute(f"UPDATE capture.projects SET {cols}, updated_at = now() WHERE id = %s",
                               (*changes.values(), project_id))
        r = await (await conn.execute("SELECT * FROM capture.projects WHERE id = %s", (project_id,))).fetchone()
    if not r:
        raise HTTPException(404, "project not found")
    return _project_json(r)


# ---- incidents ----------------------------------------------------------------
@router.get("/incidents")
async def list_incidents(request: Request, p: Principal = Depends(current_principal),
                         project_id: str | None = None, status: str | None = None, tag: str | None = None,
                         assignee: str | None = None, sensitive: str | None = None, q: str | None = None,
                         sort: Literal["updated", "created", "number"] = "updated",
                         limit: int = Query(60, ge=1, le=500), offset: int = Query(0, ge=0)):
    where, args = ["NOT i.deleted", "NOT p.archived" if not project_id else "TRUE"], []
    for col, val in (("i.project_id = %s", project_id), ("i.status = %s", status),
                     ("%s = ANY(i.tags)", tag), ("%s::uuid = ANY(i.assignees)", assignee),
                     ("%s = ANY(i.sensitive)", sensitive)):
        if val:
            where.append(col)
            args.append(val)
    if q:
        where.append("(i.description ILIKE %s OR i.place ILIKE %s OR (p.code || '-' || i.number) ILIKE %s"
                     " OR EXISTS (SELECT 1 FROM capture.items it WHERE it.incident_id = i.id"
                     "            AND (it.canonical_url ILIKE %s OR it.title ILIKE %s)))")
        like = f"%{q}%"
        args += [like] * 5
    order = {"updated": "i.updated_at DESC", "created": "i.created_at DESC", "number": "p.code, i.number DESC"}[sort]
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            INCIDENT_SELECT + " WHERE " + " AND ".join(where) + f" ORDER BY {order} LIMIT %s OFFSET %s",
            (*args, limit, offset))).fetchall()
        names = await _names(conn, list({a for r in rows for a in r["assignees"]}))
    return {"incidents": [_incident_json(r, names) for r in rows]}


async def _apply_incident_changes(conn, r: dict, body: IncidentIn, p: Principal) -> int:
    """Write changed fields and one feed entry per change. Returns how many fields changed."""
    changes = {k: v for k, v in body.model_dump(exclude_unset=True).items()
               if k in TRACKED or k == "deleted"}
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
    if "status" in changes and changes["status"] != r["status"] and (
            changes["status"] in PRIVILEGED_STATUSES or r["status"] in PRIVILEGED_STATUSES) and not p.at_least("reviewer"):
        raise HTTPException(403, "only reviewers can mark an incident completed/cancelled or reopen it")
    if "deleted" in changes and not p.at_least("editor"):
        raise HTTPException(403, "only editors can delete incidents")

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


@router.post("/incidents", status_code=201)
async def create_incident(body: IncidentIn, request: Request, p: Principal = Depends(require("contributor"))):
    if not body.project_id or not body.description:
        raise HTTPException(422, "project_id and description are required")
    if body.status in PRIVILEGED_STATUSES and not p.at_least("reviewer"):
        raise HTTPException(403, "only reviewers can create a completed/cancelled incident")
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            proj = await (await conn.execute(
                "UPDATE capture.projects SET next_number = next_number + 1 WHERE id = %s AND NOT archived"
                " RETURNING next_number - 1 AS number, attributes", (body.project_id,))).fetchone()
            if not proj:
                raise HTTPException(404, "project not found or archived")
            row = await (await conn.execute(
                "INSERT INTO capture.incidents (project_id, number, description, created_by) VALUES (%s,%s,%s,%s)"
                " RETURNING id", (body.project_id, proj["number"], body.description, p.contributor_id))).fetchone()
            await add_update(conn, incident_id=row["id"], kind="created", p=p, body=body.reason)
            r = await _get_incident(conn, row["id"])
            # Remaining attributes are set like any later edit, but without feed noise for each.
            init = body.model_copy(update={"description": body.description, "reason": None})
            fields = {k for k in body.model_fields_set if k in TRACKED and k != "description"}
            if fields:
                await _apply_incident_changes(conn, r, IncidentIn(**{k: getattr(init, k) for k in fields}), p)
                await conn.execute("DELETE FROM capture.updates WHERE incident_id = %s AND kind = 'attribute'",
                                   (row["id"],))
            saved = []
            for u in body.urls or []:
                if u.strip():
                    _, res = await save_link(conn, p, url=None, text=u, client="web", incident_id=str(row["id"]))
                    saved.append(res["item"]["id"])
            r = await _get_incident(conn, row["id"])
            names = await _names(conn, r["assignees"])
    return {**_incident_json(r, names), "saved_items": saved}


@router.get("/incidents/{incident_id}")
async def get_incident(incident_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        r = await _get_incident(conn, incident_id)
        items = await (await conn.execute(ITEM_SELECT + " WHERE i.incident_id = %s ORDER BY i.created_at",
                                          (incident_id,))).fetchall()
        thumbs = await (await conn.execute(
            "SELECT DISTINCT ON (it.id) it.id AS item_id, a.id FROM capture.items it"
            " JOIN capture.artifacts a ON a.capture_id = it.latest_capture_id"
            " WHERE it.incident_id = %s AND a.kind IN ('image', 'screenshot')"
            " ORDER BY it.id, (a.role = 'primary') DESC, (a.label = 'embed') DESC, (a.kind = 'image') DESC",
            (incident_id,))).fetchall()
        feed = await (await conn.execute(
            "SELECT u.*, c.display_name FROM capture.updates u LEFT JOIN capture.contributors c ON c.id = u.contributor_id"
            " WHERE u.incident_id = %s ORDER BY u.created_at", (incident_id,))).fetchall()
        names = await _names(conn, list({*r["assignees"], *[x for u in feed if u["field"] == "assignees"
                                                             for x in (u["old_value"] or []) + (u["new_value"] or [])]}))
        proj = await (await conn.execute("SELECT * FROM capture.projects WHERE id = %s", (r["project_id"],))).fetchone()
    thumb_by_item = {str(t["item_id"]): artifact_url(t["id"]) for t in thumbs}
    out = _incident_json(r, names)
    out["project"] = _project_json(proj)
    out["material"] = [{**item_json(i), "thumbnail_url": thumb_by_item.get(str(i["id"]))} for i in items]
    out["feed"] = [{"id": str(u["id"]), "kind": u["kind"], "field": u["field"], "old": u["old_value"],
                    "new": u["new_value"], "body": u["body"], "created_at": u["created_at"],
                    "item_id": str(u["item_id"]) if u["item_id"] else None,
                    "by": {"id": str(u["contributor_id"]) if u["contributor_id"] else None, "name": u["display_name"]}}
                   for u in feed]
    out["names"] = names
    return out


@router.patch("/incidents/{incident_id}")
async def update_incident(incident_id: str, body: IncidentIn, request: Request,
                          p: Principal = Depends(require("contributor"))):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            r = await _get_incident(conn, incident_id)
            if r["project_archived"]:
                raise HTTPException(409, "the project is archived")
            await _apply_incident_changes(conn, r, body, p)
    return await get_incident(incident_id, request, p)


@router.post("/incidents/{incident_id}/comments", status_code=201)
async def comment(incident_id: str, body: CommentIn, request: Request, p: Principal = Depends(require("contributor"))):
    async with request.app.state.pool.connection() as conn:
        r = await _get_incident(conn, incident_id)
        await add_update(conn, incident_id=r["id"], kind="comment", p=p, body=body.body.strip())
        await conn.execute("UPDATE capture.incidents SET updated_at = now() WHERE id = %s", (r["id"],))
    return {"ok": True}


@router.post("/incidents/{incident_id}/material")
async def add_material(incident_id: str, body: MaterialIn, request: Request, response: Response,
                       p: Principal = Depends(require("contributor"))):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            status, res = await save_link(conn, p, url=body.url, text=body.text, note=body.note, client="web",
                                          new_version=body.new_version, incident_id=incident_id)
            await conn.execute("UPDATE capture.incidents SET updated_at = now() WHERE id = %s", (incident_id,))
    response.status_code = status
    return res


@router.get("/incidents.csv")
async def export_csv(request: Request, project_id: str, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        proj = await (await conn.execute("SELECT * FROM capture.projects WHERE id = %s", (project_id,))).fetchone()
        if not proj:
            raise HTTPException(404, "project not found")
        rows = await (await conn.execute(
            INCIDENT_SELECT + " WHERE i.project_id = %s AND NOT i.deleted ORDER BY i.number", (project_id,))).fetchall()
        urls = await (await conn.execute(
            "SELECT it.incident_id, string_agg(it.canonical_url, ' ' ORDER BY it.created_at) AS urls"
            " FROM capture.items it JOIN capture.incidents i ON i.id = it.incident_id WHERE i.project_id = %s"
            " GROUP BY it.incident_id", (project_id,))).fetchall()
        names = await _names(conn, list({a for r in rows for a in r["assignees"]}))
    by_inc = {str(u["incident_id"]): u["urls"] for u in urls}
    attrs = proj["attributes"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "description", "status", "sensitive", "tags", "event_date", "place", "lat", "lng",
                "geo_precision", "assignees", *[a["name"] for a in attrs], "source_urls", "created_at", "updated_at"])
    for r in rows:
        custom = r["custom"]
        w.writerow([f"{r['code']}-{r['number']}", r["description"], r["status"], "|".join(r["sensitive"]),
                    "|".join(r["tags"]), r["event_date"] or "", r["place"] or "", r["lat"] or "", r["lng"] or "",
                    r["geo_precision"] or "", "|".join(names.get(str(a), "") for a in r["assignees"]),
                    *["|".join(v) if isinstance(v := custom.get(a["id"], ""), list) else v for a in attrs],
                    by_inc.get(str(r["id"]), ""), r["created_at"].isoformat(), r["updated_at"].isoformat()])
    return Response("﻿" + buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{proj["code"]}-incidents.csv"'})

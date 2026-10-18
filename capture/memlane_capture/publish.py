"""Publication: the reviewed public version of an incident or a community memory (integration-design §6).

A publication is a separate artifact, never the internal record: its own wording, a generalised location
(geo.py, the §12.4 policy), a coarsened date if wanted, and only the media the reviewers chose, published as
cleaned copies. Nothing is public until two different people approve the current draft:

  * a manager of the project (or an owner / instance admin), and
  * a member entrusted with publication access ("Quyền công bố", project_members.can_publish).

Editing the draft clears both approvals. Approving freezes what is shown about each piece of source material
(verdict, capture time, manifest hash, Wayback link) so later re-captures can't change a published record
silently. A manager or a publisher can withdraw a publication at once (no second approval: taking something
down must be fast); the feed then carries a tombstone and deletes its files.
"""

import secrets
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from . import geo
from .access import at_least, project_role, require_project
from .auth import Principal, current_principal, require
from .config import settings
from .inbox_core import add_update

router = APIRouter(prefix="/v1")

PUBLIC_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
PUBLISHABLE_KINDS = ("image", "screenshot", "video", "audio")
VERDICT_PUBLIC = {"complete": "archived", "partial": "partially_archived", "restricted": "restricted",
                  "walled": "login_wall", "unavailable": "unavailable"}
PlaceKind = Literal[tuple(geo.PLACE_KINDS)]  # type: ignore[valid-type]
Precision = Literal[tuple(geo.LEVELS)]  # type: ignore[valid-type]


def new_public_id(prefix: str) -> str:
    """Random, never derived from internal ids or incident numbers (they reveal internal structure)."""
    return prefix + "-" + "".join(secrets.choice(PUBLIC_ALPHABET) for _ in range(7))


# ---- draft models -------------------------------------------------------------------------------
class MaterialDraft(BaseModel):
    item_id: str
    public_id: str | None = None
    show_original_url: bool = True          # decision 4: shown by default, withheld per record if needed
    summary_vi: str | None = Field(None, max_length=2000)
    summary_en: str | None = Field(None, max_length=2000)
    files: list[str] = Field(default_factory=list, max_length=20)     # artifact ids


class DraftPatch(BaseModel):
    """Every field optional: a PATCH merges into the draft."""
    title_vi: str | None = Field(None, max_length=300)
    title_en: str | None = Field(None, max_length=300)
    summary_vi: str | None = Field(None, max_length=10000)
    summary_en: str | None = Field(None, max_length=10000)
    text_vi: str | None = Field(None, max_length=8000)         # memories
    text_en: str | None = Field(None, max_length=8000)
    category: Literal["personal", "news", "community", "event"] | None = None
    group: str | None = Field(None, max_length=80)
    tags: list[str] | None = Field(None, max_length=20)
    public_status: Literal["reported", "being_verified", "verified"] | None = None
    date: str | None = Field(None, pattern=r"^\d{4}(-\d{2}(-\d{2})?)?$")
    date_precision: Literal["day", "month", "year"] | None = None
    place_kind: PlaceKind | None = None
    precision: Precision | None = None
    precision_reason: str | None = Field(None, max_length=1000)
    place_label: str | None = Field(None, max_length=200)
    refresh_location: bool = False          # copy the incident's current (internal) location into the draft
    materials: list[MaterialDraft] | None = Field(None, max_length=100)
    community_files: list[str] | None = Field(None, max_length=50)    # intake file ids
    files: list[str] | None = Field(None, max_length=10)              # memories: intake file ids
    credit: str | None = Field(None, max_length=80)


class ApproveIn(BaseModel):
    role: Literal["manager", "publisher"]


class WithdrawIn(BaseModel):
    reason: str = Field(..., min_length=1, max_length=2000)


# ---- helpers ------------------------------------------------------------------------------------------
async def can_publish(conn, p: Principal, project_id) -> bool:
    r = await (await conn.execute("SELECT can_publish FROM capture.project_members WHERE project_id = %s"
                                  " AND contributor_id = %s", (project_id, p.contributor_id))).fetchone()
    return bool(r and r["can_publish"])


async def mark_feed_dirty(conn) -> None:
    await conn.execute("UPDATE capture.feed_state SET dirty = true WHERE id = 1")


def _date_from_parts(d: dict | None) -> tuple[str | None, str]:
    d = d or {}
    if d.get("year") and d.get("month") and d.get("day"):
        return f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}", "day"
    if d.get("year") and d.get("month"):
        return f"{d['year']:04d}-{d['month']:02d}", "month"
    if d.get("year"):
        return f"{d['year']:04d}", "year"
    return None, "day"


async def _publishable_artifacts(conn, item_id) -> list[str]:
    rows = await (await conn.execute(
        "SELECT a.id FROM capture.items i JOIN capture.artifacts a ON a.capture_id = i.latest_capture_id"
        " WHERE i.id = %s AND a.role = 'primary' AND a.kind = ANY(%s) AND a.sha256 IS NOT NULL ORDER BY a.kind, a.label",
        (item_id, list(PUBLISHABLE_KINDS)))).fetchall()
    return [str(r["id"]) for r in rows]


async def incident_draft(conn, inc: dict) -> dict:
    """A first draft from an incident. Nothing internal is copied into public text except the description,
    which the reviewers rewrite; the internal 'place' text is never copied (it can be an address)."""
    items = await (await conn.execute(
        "SELECT ii.item_id, c.verdict FROM capture.item_incidents ii JOIN capture.items i ON i.id = ii.item_id"
        " LEFT JOIN capture.captures c ON c.id = i.latest_capture_id WHERE ii.incident_id = %s ORDER BY ii.added_at",
        (inc["id"],))).fetchall()
    materials = []
    for it in items:
        if it["verdict"] in VERDICT_PUBLIC:
            materials.append({"item_id": str(it["item_id"]), "public_id": new_public_id("mt"), "show_original_url": True,
                              "files": await _publishable_artifacts(conn, it["item_id"])})
    files = await (await conn.execute(
        "SELECT f.id FROM capture.intake_files f JOIN capture.intake k ON k.id = f.intake_id"
        " WHERE k.incident_id = %s AND f.state = 'stored' AND f.kind IN ('image', 'video') ORDER BY k.received_at, f.n",
        (inc["id"],))).fetchall()
    attrs = inc.get("project_attributes") or []
    group_attr = next((a for a in attrs if a["name"].strip().lower() == "nhóm hồ sơ"), None)
    desc = inc["description"] or ""
    return {
        "title_vi": desc.split("\n")[0][:200], "summary_vi": desc, "title_en": None, "summary_en": None,
        "group": (inc["custom"] or {}).get(group_attr["id"]) if group_attr else None, "tags": [],
        "public_status": "being_verified",
        "date": inc["event_date"].isoformat() if inc["event_date"] else None, "date_precision": "day",
        # Safe default (§12.4 "private home, city"): reviewers pick the kind of place and may go coarser.
        "place_kind": "private_city", "precision": "ward", "precision_reason": None, "place_label": None,
        "lat": inc["lat"], "lng": inc["lng"],
        "materials": materials, "community_files": [str(f["id"]) for f in files], "credit": None,
    }


def memory_draft(k: dict, file_ids: list[str]) -> dict:
    pl = k["payload"] or {}
    loc = pl.get("location") or {}
    kind = "legacy_memory" if k["legacy_public"] else "memory"
    precision = geo.PLACE_KINDS[kind]["default"]
    wish = loc.get("precision_wish")
    if wish and geo.RANK[wish] > geo.RANK[precision]:
        precision = wish                      # the submitter asked for coarser
    date, date_precision = _date_from_parts(pl.get("date"))
    label_parts = [loc.get("ward") if geo.RANK[precision] <= geo.RANK["ward"] else None,
                   loc.get("city") or loc.get("province")]
    return {
        "text_vi": pl.get("text"), "text_en": pl.get("text_en"), "category": pl.get("category", "personal"),
        "date": date, "date_precision": date_precision,
        "place_kind": kind, "precision": precision, "precision_reason": None,
        "submitter_max": wish, "submitter_allows_exact": bool(loc.get("allow_exact")) or k["legacy_public"],
        "place_label": ", ".join(x for x in label_parts if x) or None,
        "lat": loc.get("lat"), "lng": loc.get("lng"),
        "files": file_ids, "credit": pl.get("pseudonym"), "case_ref": pl.get("case_ref"),
        "legacy_external_id": k["external_id"] if k["legacy_public"] else None,
    }


def problems(pub_type: str, d: dict) -> list[str]:
    """What blocks approval of this draft."""
    out = []
    try:
        geo.check(d.get("place_kind") or "", d.get("precision") or "", d.get("precision_reason"),
                  d.get("submitter_max"), bool(d.get("submitter_allows_exact")))
    except geo.PolicyError as e:
        out.append(str(e))
    if pub_type == "incident" and not (d.get("title_vi") or "").strip():
        out.append("a public title (VI) is required")
    if pub_type == "memory" and not (d.get("text_vi") or "").strip():
        out.append("the memory text (VI) is required")
    if d.get("precision") != "none" and (d.get("lat") is None or d.get("lng") is None):
        out.append("no internal location to generalise: choose precision 'none' or add a location")
    return out


async def freeze(conn, pub_type: str, d: dict) -> dict:
    """The draft plus what is shown about each source material and file, fixed at this moment."""
    snap = dict(d)
    if pub_type == "incident":
        mats = []
        for m in d.get("materials") or []:
            it = await (await conn.execute(
                "SELECT i.id, i.canonical_url, i.platform, i.kind, i.title, c.verdict, c.finished_at, c.manifest_sha256"
                " FROM capture.items i LEFT JOIN capture.captures c ON c.id = i.latest_capture_id WHERE i.id = %s",
                (m["item_id"],))).fetchone()
            if not it:
                continue
            wb = await (await conn.execute(
                "SELECT copy_url FROM capture.external_copies WHERE item_id = %s AND state = 'done'"
                " ORDER BY created_at DESC LIMIT 1", (it["id"],))).fetchone()
            files = []
            for aid in m.get("files") or []:
                a = await (await conn.execute(
                    "SELECT a.id, a.kind, a.label, a.sha256, a.mime, c.item_id, c.manifest_sha256 FROM capture.artifacts a"
                    " JOIN capture.captures c ON c.id = a.capture_id WHERE a.id = %s", (aid,))).fetchone()
                if a and str(a["item_id"]) == str(it["id"]) and a["kind"] in PUBLISHABLE_KINDS and a["sha256"]:
                    files.append({"source": "artifact", "id": str(a["id"]), "kind": a["kind"], "label": a["label"],
                                  "source_sha256": a["sha256"], "mime": a["mime"],
                                  "manifest_sha256": a["manifest_sha256"]})
            mats.append({**m, "platform": it["platform"], "kind": it["kind"], "title": it["title"],
                         "verdict": it["verdict"], "captured_at": it["finished_at"].isoformat() if it["finished_at"] else None,
                         "manifest_sha256": it["manifest_sha256"], "original_url": it["canonical_url"],
                         "wayback_url": wb["copy_url"] if wb else None, "frozen_files": files})
        snap["materials"] = mats
    ids = d.get("community_files") if pub_type == "incident" else d.get("files")
    cf = []
    for fid in ids or []:
        f = await (await conn.execute("SELECT id, kind, sha256, mime FROM capture.intake_files WHERE id = %s"
                                      " AND state = 'stored'", (fid,))).fetchone()
        if f and f["kind"] in ("image", "video"):
            cf.append({"source": "intake_file", "id": str(f["id"]), "kind": f["kind"], "label": "community",
                       "source_sha256": f["sha256"], "mime": f["mime"]})
    snap["frozen_community_files"] = cf
    snap["frozen_at"] = datetime.now(timezone.utc).isoformat()
    return snap


def _pub_json(r: dict, role: str | None, publisher: bool, names: dict) -> dict:
    return {"id": str(r["id"]), "public_id": r["public_id"], "type": r["type"], "state": r["state"],
            "project_id": str(r["project_id"]), "incident_id": str(r["incident_id"]) if r["incident_id"] else None,
            "intake_id": str(r["intake_id"]) if r["intake_id"] else None,
            "batch_id": str(r["batch_id"]) if r["batch_id"] else None,
            "draft": r["draft"], "version": r["version"], "dirty": r["dirty"],
            "approved_by_manager": names.get(str(r["approved_by_manager"])) if r["approved_by_manager"] else None,
            "approved_by_publisher": names.get(str(r["approved_by_publisher"])) if r["approved_by_publisher"] else None,
            "published_at": r["published_at"], "withdrawn_at": r["withdrawn_at"],
            "withdrawn_reason": r["withdrawn_reason"], "updated_at": r["updated_at"],
            "problems": problems(r["type"], r["draft"]),
            "my_role": role, "can_publish": publisher, "feed_url": settings.feed_public_url or None}


async def _load(conn, pub_id: str, p: Principal, minimum: str = "viewer") -> tuple[dict, str]:
    r = await (await conn.execute("SELECT * FROM capture.publications WHERE id = %s", (pub_id,))).fetchone()
    if not r:
        raise HTTPException(404, "publication not found")
    role = await require_project(conn, p, r["project_id"], "viewer")
    if not at_least(role, minimum):
        raise HTTPException(403, f"requires the {minimum} role in this project")
    return r, role


async def _out(conn, r: dict, p: Principal, role: str) -> dict:
    ids = [x for x in (r["approved_by_manager"], r["approved_by_publisher"]) if x]
    names = {}
    if ids:
        rows = await (await conn.execute("SELECT id, display_name FROM capture.contributors WHERE id = ANY(%s::uuid[])",
                                         ([str(i) for i in ids],))).fetchall()
        names = {str(x["id"]): x["display_name"] for x in rows}
    out = _pub_json(r, role, await can_publish(conn, p, r["project_id"]), names)
    from .feed import public_record     # the same function the feed uses: the preview is what will be published
    snap = await freeze(conn, r["type"], r["draft"])
    out["preview"] = public_record(r["type"], r["public_id"], r["version"] + 1, None, snap, resolve=None)
    return out


async def _log(conn, r: dict, p: Principal, action: str, body: str | None = None) -> None:
    if r["incident_id"]:
        await add_update(conn, incident_id=r["incident_id"], kind="publication", p=p,
                         new={"action": action, "public_id": r["public_id"], "version": r["version"]}, body=body)


# ---- endpoints ---------------------------------------------------------------------------------------
@router.get("/publications")
async def list_publications(request: Request, project_id: str | None = None, state: str | None = None,
                            p: Principal = Depends(current_principal)):
    where, args = [], []
    if p.role != "admin":
        where.append("EXISTS (SELECT 1 FROM capture.project_members m WHERE m.project_id = pb.project_id"
                     " AND m.contributor_id = %s AND m.role <> 'data_only_viewer')")
        args.append(p.contributor_id)
    if project_id:
        where.append("pb.project_id = %s")
        args.append(project_id)
    if state:
        where.append("pb.state = %s")
        args.append(state)
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT pb.*, pr.code, inc.number FROM capture.publications pb JOIN capture.projects pr ON pr.id = pb.project_id"
            " LEFT JOIN capture.incidents inc ON inc.id = pb.incident_id"
            + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY pb.updated_at DESC LIMIT 500",
            tuple(args))).fetchall()
    return {"publications": [{"id": str(r["id"]), "public_id": r["public_id"], "type": r["type"], "state": r["state"],
                              "version": r["version"], "dirty": r["dirty"], "project_id": str(r["project_id"]),
                              "incident": f"{r['code']}-{r['number']}" if r["number"] else None,
                              "intake_id": str(r["intake_id"]) if r["intake_id"] else None,
                              "batch_id": str(r["batch_id"]) if r["batch_id"] else None,
                              "title": (r["draft"].get("title_vi") or r["draft"].get("text_vi") or "")[:200],
                              "approvals": int(bool(r["approved_by_manager"])) + int(bool(r["approved_by_publisher"])),
                              "published_at": r["published_at"], "updated_at": r["updated_at"]} for r in rows]}


@router.get("/publications/{pub_id}")
async def get_publication(pub_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        r, role = await _load(conn, pub_id, p)
        return await _out(conn, r, p, role)


@router.post("/incidents/{incident_id}/publication", status_code=201)
async def start_incident_publication(incident_id: str, request: Request, p: Principal = Depends(current_principal)):
    from .workspace import _get_incident
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            inc, role = await _get_incident(conn, incident_id, p, "editor")
            r = await (await conn.execute("SELECT * FROM capture.publications WHERE incident_id = %s",
                                          (incident_id,))).fetchone()
            if not r:
                r = await (await conn.execute(
                    "INSERT INTO capture.publications (public_id, type, project_id, incident_id, draft, dirty, drafted_by)"
                    " VALUES (%s, 'incident', %s, %s, %s, true, %s) RETURNING *",
                    (new_public_id("hs"), inc["project_id"], incident_id, Jsonb(await incident_draft(conn, inc)),
                     p.contributor_id))).fetchone()
                await _log(conn, r, p, "drafted")
        return await _out(conn, r, p, role)


@router.post("/intake/{intake_id}/publication", status_code=201)
async def start_memory_publication(intake_id: str, request: Request, p: Principal = Depends(current_principal)):
    from .intake import _get_intake
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            k, role = await _get_intake(conn, intake_id, p, "editor")
            if k["kind"] != "memory":
                raise HTTPException(409, "only memories are published on their own; file other submissions under an incident")
            r = await _memory_publication(conn, k, p)
        return await _out(conn, r, p, role)


async def _memory_publication(conn, k: dict, p: Principal, batch_id=None) -> dict:
    r = await (await conn.execute("SELECT * FROM capture.publications WHERE intake_id = %s", (k["id"],))).fetchone()
    if r:
        return r
    files = await (await conn.execute("SELECT id FROM capture.intake_files WHERE intake_id = %s AND state = 'stored'"
                                      " AND kind IN ('image', 'video') ORDER BY n", (k["id"],))).fetchall()
    return await (await conn.execute(
        "INSERT INTO capture.publications (public_id, type, project_id, intake_id, batch_id, draft, dirty, drafted_by)"
        " VALUES (%s, 'memory', %s, %s, %s, %s, true, %s) RETURNING *",
        (new_public_id("km"), k["project_id"], k["id"], batch_id,
         Jsonb(memory_draft(k, [str(f["id"]) for f in files])), p.contributor_id))).fetchone()


@router.patch("/publications/{pub_id}")
async def edit_publication(pub_id: str, body: DraftPatch, request: Request, p: Principal = Depends(current_principal)):
    ch = body.model_dump(exclude_unset=True)
    refresh = ch.pop("refresh_location", False)
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            r, role = await _load(conn, pub_id, p, "editor")
            if r["state"] == "withdrawn":
                raise HTTPException(409, "withdrawn: start a new publication instead")
            d = {**r["draft"], **ch}
            if "materials" in ch:
                for m in d["materials"]:
                    m["public_id"] = m.get("public_id") or new_public_id("mt")
            if refresh and r["incident_id"]:
                inc = await (await conn.execute("SELECT lat, lng FROM capture.incidents WHERE id = %s",
                                                (r["incident_id"],))).fetchone()
                d["lat"], d["lng"] = inc["lat"], inc["lng"]
            # Any edit needs fresh approvals: what was approved is no longer what would be published.
            r = await (await conn.execute(
                "UPDATE capture.publications SET draft = %s, dirty = true, approved_by_manager = NULL,"
                " approved_by_publisher = NULL, updated_at = now() WHERE id = %s RETURNING *",
                (Jsonb(d), pub_id))).fetchone()
        return await _out(conn, r, p, role)


async def _publish_now(conn, r: dict) -> dict:
    snap = await freeze(conn, r["type"], r["draft"])
    r = await (await conn.execute(
        "UPDATE capture.publications SET published = %s, version = version + 1, state = 'published', dirty = false,"
        " published_at = now(), withdrawn_at = NULL, withdrawn_reason = NULL, approved_by_manager = NULL,"
        " approved_by_publisher = NULL, updated_at = now() WHERE id = %s RETURNING *", (Jsonb(snap), r["id"]))).fetchone()
    if r["intake_id"]:
        await conn.execute("UPDATE capture.intake SET state = 'published' WHERE id = %s AND state = 'new'",
                           (r["intake_id"],))
    await mark_feed_dirty(conn)
    return r


async def _approval_slot(conn, p: Principal, project_id, role_name: str, other_approver) -> str:
    if role_name == "manager":
        if not at_least(await project_role(conn, p, project_id), "manager"):
            raise HTTPException(403, "only managers of this project can give the manager approval")
    elif not await can_publish(conn, p, project_id):
        raise HTTPException(403, "you don't have publication access in this project")
    if other_approver and str(other_approver) == p.contributor_id:
        raise HTTPException(409, "the two approvals must come from two different people")
    return "approved_by_manager" if role_name == "manager" else "approved_by_publisher"


@router.post("/publications/{pub_id}/approve")
async def approve(pub_id: str, body: ApproveIn, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            r, role = await _load(conn, pub_id, p)
            r = await (await conn.execute("SELECT * FROM capture.publications WHERE id = %s FOR UPDATE",
                                          (pub_id,))).fetchone()
            if not r["dirty"] and r["state"] == "published":
                raise HTTPException(409, "nothing new to approve: the current draft is what is published")
            if r["batch_id"] and r["state"] == "draft":
                raise HTTPException(409, "part of a batch: approve the batch")
            if probs := problems(r["type"], r["draft"]):
                raise HTTPException(422, "; ".join(probs))
            other = r["approved_by_publisher"] if body.role == "manager" else r["approved_by_manager"]
            col = await _approval_slot(conn, p, r["project_id"], body.role, other)
            r = await (await conn.execute(f"UPDATE capture.publications SET {col} = %s, updated_at = now()"
                                          " WHERE id = %s RETURNING *", (p.contributor_id, pub_id))).fetchone()
            await _log(conn, r, p, f"approved_{body.role}")
            if r["approved_by_manager"] and r["approved_by_publisher"]:
                r = await _publish_now(conn, r)
                await _log(conn, r, p, "published", f"Đã công bố {r['public_id']} (phiên bản {r['version']})")
        return await _out(conn, r, p, role)


@router.post("/publications/{pub_id}/withdraw")
async def withdraw(pub_id: str, body: WithdrawIn, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            r, role = await _load(conn, pub_id, p)
            if not (at_least(role, "manager") or await can_publish(conn, p, r["project_id"])):
                raise HTTPException(403, "only managers or members with publication access can withdraw")
            if r["state"] != "published":
                raise HTTPException(409, "not published")
            r = await (await conn.execute(
                "UPDATE capture.publications SET state = 'withdrawn', withdrawn_at = now(), withdrawn_reason = %s,"
                " approved_by_manager = NULL, approved_by_publisher = NULL, updated_at = now() WHERE id = %s RETURNING *",
                (body.reason.strip(), pub_id))).fetchone()
            await mark_feed_dirty(conn)
            await _log(conn, r, p, "withdrawn", body.reason.strip())
        return await _out(conn, r, p, role)


@router.post("/publications/{pub_id}/republish")
async def republish(pub_id: str, request: Request, p: Principal = Depends(current_principal)):
    """Back to draft after a withdrawal; it needs both approvals again."""
    async with request.app.state.pool.connection() as conn:
        r, role = await _load(conn, pub_id, p, "editor")
        if r["state"] != "withdrawn":
            raise HTTPException(409, "only withdrawn publications")
        r = await (await conn.execute("UPDATE capture.publications SET state = 'draft', dirty = true, updated_at = now()"
                                      " WHERE id = %s RETURNING *", (pub_id,))).fetchone()
        return await _out(conn, r, p, role)


# ---- batches: already-public legacy records (§9) -------------------------------------------------------
@router.get("/projects/{project_id}/publication-batches")
async def list_batches(project_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        await require_project(conn, p, project_id, "viewer")
        rows = await (await conn.execute(
            "SELECT b.*, (SELECT count(*) FROM capture.publications pb WHERE pb.batch_id = b.id) AS n"
            " FROM capture.publication_batches b WHERE b.project_id = %s ORDER BY b.created_at DESC",
            (project_id,))).fetchall()
        waiting = (await (await conn.execute(
            "SELECT count(*) AS n FROM capture.intake k WHERE k.project_id = %s AND k.legacy_public AND k.kind = 'memory'"
            " AND NOT EXISTS (SELECT 1 FROM capture.publications x WHERE x.intake_id = k.id)", (project_id,))).fetchone())["n"]
        publisher = await can_publish(conn, p, project_id)
    return {"batches": [{"id": str(b["id"]), "label": b["label"], "count": b["n"], "created_at": b["created_at"],
                         "approved_by_manager": bool(b["approved_by_manager"]),
                         "approved_by_publisher": bool(b["approved_by_publisher"]),
                         "published_at": b["published_at"]} for b in rows],
            "legacy_waiting": waiting, "can_publish": publisher}


@router.post("/projects/{project_id}/publication-batches", status_code=201)
async def create_legacy_batch(project_id: str, request: Request, p: Principal = Depends(current_principal)):
    """Drafts for every already-public legacy memory in this project that has none yet, as one batch."""
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            await require_project(conn, p, project_id, "editor")
            ks = await (await conn.execute(
                "SELECT * FROM capture.intake k WHERE k.project_id = %s AND k.legacy_public AND k.kind = 'memory'"
                " AND NOT EXISTS (SELECT 1 FROM capture.publications x WHERE x.intake_id = k.id) ORDER BY k.received_at",
                (project_id,))).fetchall()
            if not ks:
                raise HTTPException(409, "no legacy memories waiting")
            b = await (await conn.execute(
                "INSERT INTO capture.publication_batches (project_id, label, drafted_by) VALUES (%s, %s, %s) RETURNING *",
                (project_id, f"Ký ức đã công khai trước đây ({len(ks)})", p.contributor_id))).fetchone()
            for k in ks:
                await _memory_publication(conn, k, p, batch_id=b["id"])
    return {"id": str(b["id"]), "count": len(ks)}


@router.post("/publication-batches/{batch_id}/approve")
async def approve_batch(batch_id: str, body: ApproveIn, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            b = await (await conn.execute("SELECT * FROM capture.publication_batches WHERE id = %s FOR UPDATE",
                                          (batch_id,))).fetchone()
            if not b:
                raise HTTPException(404, "batch not found")
            await require_project(conn, p, b["project_id"], "viewer")
            if b["published_at"]:
                raise HTTPException(409, "already published")
            pubs = await (await conn.execute("SELECT * FROM capture.publications WHERE batch_id = %s AND state = 'draft'",
                                             (batch_id,))).fetchall()
            bad = [f"{x['public_id']}: {'; '.join(pr)}" for x in pubs if (pr := problems(x["type"], x["draft"]))]
            if bad:
                raise HTTPException(422, "fix these first: " + " | ".join(bad[:10]))
            other = b["approved_by_publisher"] if body.role == "manager" else b["approved_by_manager"]
            col = await _approval_slot(conn, p, b["project_id"], body.role, other)
            b = await (await conn.execute(f"UPDATE capture.publication_batches SET {col} = %s WHERE id = %s RETURNING *",
                                          (p.contributor_id, batch_id))).fetchone()
            published = 0
            if b["approved_by_manager"] and b["approved_by_publisher"]:
                for x in pubs:
                    await _publish_now(conn, x)
                    published += 1
                await conn.execute("UPDATE capture.publication_batches SET published_at = now() WHERE id = %s", (batch_id,))
    return {"approved_by_manager": bool(b["approved_by_manager"]),
            "approved_by_publisher": bool(b["approved_by_publisher"]), "published": published}


# ---- feed status ------------------------------------------------------------------------------------------
@router.get("/feed/status")
async def feed_status(request: Request, p: Principal = Depends(current_principal)):
    from .feedkeys import server_keys
    async with request.app.state.pool.connection() as conn:
        s = await (await conn.execute("SELECT * FROM capture.feed_state WHERE id = 1")).fetchone()
        n = await (await conn.execute("SELECT count(*) FILTER (WHERE state = 'published') AS live,"
                                      " count(*) FILTER (WHERE state = 'withdrawn') AS withdrawn"
                                      " FROM capture.publications WHERE version > 0")).fetchone()
    try:
        configured = server_keys(settings) is not None
    except Exception:  # noqa: BLE001 - unreadable key files count as not configured
        configured = False
    return {"configured": configured, "public_url": settings.feed_public_url or None, "dirty": s["dirty"],
            "built_at": s["built_at"], "index_sha256": s["index_sha256"], "error": s["error"], **n}


@router.post("/feed/rebuild", status_code=202)
async def feed_rebuild(request: Request, p: Principal = Depends(require("admin"))):
    async with request.app.state.pool.connection() as conn:
        await mark_feed_dirty(conn)
    return {"queued": True}

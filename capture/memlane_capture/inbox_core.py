"""Saving a link: shared by the inbox (share sheet, extension) and an incident's "+ Add material"."""

from fastapi import HTTPException
from psycopg.types.json import Jsonb

from .access import project_role, require_project
from .auth import Principal
from .config import settings
from .notify import fan_out
from .urls import canonicalize, classify, extract_url

ITEM_SELECT = """
SELECT i.*, c.display_name AS submitted_by_name,
       lc.state AS capture_state, lc.verdict, lc.verdict_reasons, lc.extracted, lc.finished_at AS captured_at,
       lc.manifest_sha256,
       inc.number AS incident_number, inc.description AS incident_description, p.code AS project_code,
       p.color AS project_color, p.id AS project_id
  FROM capture.items i
  LEFT JOIN capture.contributors c ON c.id = i.submitted_by
  LEFT JOIN capture.captures lc ON lc.id = i.latest_capture_id
  LEFT JOIN capture.incidents inc ON inc.id = i.incident_id
  LEFT JOIN capture.projects p ON p.id = inc.project_id
"""


def item_json(r: dict) -> dict:
    return {
        "id": str(r["id"]), "url": r["submitted_url"], "canonical_url": r["canonical_url"],
        "resolved_url": r["resolved_url"], "platform": r["platform"], "kind": r["kind"], "status": r["status"],
        "title": r["title"], "note": r["note"], "case_ref": r["case_ref"], "tags": r["tags"],
        "sensitive": r["sensitive"], "client": r["client"], "created_at": r["created_at"],
        "submitted_by": {"id": str(r["submitted_by"]) if r["submitted_by"] else None,
                         "name": r.get("submitted_by_name")},
        "incident": None if not r.get("incident_id") else {
            "id": str(r["incident_id"]), "slug": f"{r['project_code']}-{r['incident_number']}",
            "description": r["incident_description"], "project_id": str(r["project_id"]),
            "color": r["project_color"],
        },
        "latest_capture": None if not r.get("capture_state") else {
            "id": str(r["latest_capture_id"]), "state": r["capture_state"], "verdict": r["verdict"],
            "reasons": r["verdict_reasons"], "extracted": r["extracted"], "captured_at": r["captured_at"],
            "manifest_sha256": r["manifest_sha256"],
        },
    }


async def can_see_item(conn, p: Principal, r: dict) -> bool:
    """Its submitter, global reviewers, and members of the project it is filed under."""
    if p.at_least("reviewer") or str(r["submitted_by"]) == p.contributor_id:
        return True
    return bool(r.get("project_id")) and await project_role(conn, p, r["project_id"]) is not None


async def new_capture(conn, item_id, p: Principal) -> str:
    cap = await (await conn.execute(
        "INSERT INTO capture.captures (item_id, requested_by) VALUES (%s, %s) RETURNING id",
        (item_id, p.contributor_id))).fetchone()
    await conn.execute("UPDATE capture.items SET latest_capture_id = %s, status = 'queued', updated_at = now()"
                       " WHERE id = %s", (cap["id"], item_id))
    return str(cap["id"])


async def add_update(conn, *, incident_id, kind: str, p: Principal | None = None, item_id=None, field=None,
                     old=None, new=None, body: str | None = None, notify: bool = True) -> str:
    """Write a feed entry and notify the people following the incident (notify.py)."""
    row = await (await conn.execute(
        "INSERT INTO capture.updates (incident_id, item_id, contributor_id, kind, field, old_value, new_value, body)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (incident_id, item_id, p.contributor_id if p else None, kind, field,
         Jsonb(old) if old is not None else None, Jsonb(new) if new is not None else None, body))).fetchone()
    if notify and incident_id:
        await fan_out(conn, update_id=row["id"], incident_id=incident_id, kind=kind,
                      actor_id=p.contributor_id if p else None, field=field, old=old, new=new, body=body)
    return str(row["id"])


async def save_link(conn, p: Principal, *, url: str | None, text: str | None, title: str | None = None,
                    note: str | None = None, case_ref: str | None = None, tags: list[str] | None = None,
                    sensitive: bool = False, client: str = "api", new_version: bool = False,
                    incident_id: str | None = None, rate_limit: bool = True) -> tuple[int, dict]:
    """Returns (http_status, body). Must run inside a transaction."""
    submitted = (url or "").strip() or extract_url(text or "")
    if submitted and not submitted.lower().startswith(("http://", "https://")):
        submitted = extract_url(submitted)
    if not submitted:
        raise HTTPException(422, "no http(s) link found in url/text")
    canonical = canonicalize(submitted)
    cls = classify(canonical)

    if rate_limit:
        recent = await (await conn.execute(
            "SELECT count(*) AS n FROM capture.items WHERE submitted_by = %s AND created_at > now() - interval '1 hour'",
            (p.contributor_id,))).fetchone()
        if recent["n"] >= settings.submit_rate_per_hour:
            raise HTTPException(429, "too many links this hour, try again later")

    if incident_id:
        inc = await (await conn.execute(
            "SELECT i.id, i.project_id, p.archived FROM capture.incidents i JOIN capture.projects p ON p.id = i.project_id"
            " WHERE i.id = %s AND NOT i.deleted", (incident_id,))).fetchone()
        if not inc:
            raise HTTPException(404, "incident not found")
        await require_project(conn, p, inc["project_id"], "editor")
        if inc["archived"]:
            raise HTTPException(409, "the project is archived")

    # Serialise concurrent saves of the same link (double taps, two people at once).
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (canonical,))
    existing = await (await conn.execute(
        ITEM_SELECT + " WHERE i.canonical_url = %s OR i.resolved_url = %s ORDER BY i.created_at DESC LIMIT 1",
        (canonical, canonical))).fetchone()

    if existing:
        # A saved link with no incident yet is simply filed under the one it is being added to.
        if incident_id and not existing["incident_id"]:
            await conn.execute("UPDATE capture.items SET incident_id = %s, updated_at = now() WHERE id = %s",
                               (incident_id, existing["id"]))
            await add_update(conn, incident_id=incident_id, kind="material_added", p=p, item_id=existing["id"])
            from .external import queue_wayback  # local import: external imports this module
            await queue_wayback(conn, existing["id"])
        if new_version and existing["capture_state"] not in ("queued", "running"):
            await new_capture(conn, existing["id"], p)
        existing = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s", (existing["id"],))).fetchone()
        item = item_json(existing)
        # Saved by someone else, in their private inbox or a project you aren't in: say only that it exists.
        if not await can_see_item(conn, p, existing):
            item = {"id": item["id"], "canonical_url": item["canonical_url"], "platform": item["platform"],
                    "kind": item["kind"], "status": item["status"], "created_at": item["created_at"],
                    "submitted_by": item["submitted_by"], "latest_capture": None, "incident": None, "visible": False}
        return 200, {"created": False, "duplicate": True, "new_version": new_version, "item": item}

    row = await (await conn.execute(
        "INSERT INTO capture.items (submitted_url, submitted_text, canonical_url, platform, kind, title, note,"
        " case_ref, tags, sensitive, client, submitted_by, incident_id)"
        " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (submitted, text, canonical, cls.platform, cls.kind, title, note, case_ref,
         [t.strip()[:60] for t in (tags or []) if t.strip()], sensitive, client, p.contributor_id,
         incident_id))).fetchone()
    await new_capture(conn, row["id"], p)
    if incident_id:
        await add_update(conn, incident_id=incident_id, kind="material_added", p=p, item_id=row["id"])
    item = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s", (row["id"],))).fetchone()
    return 201, {"created": True, "duplicate": False, "new_version": False, "item": item_json(item)}

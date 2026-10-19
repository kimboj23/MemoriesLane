"""Saving a link and filing it under incidents: shared by the inbox (share sheet, extension), an incident's
"+ Add material", and the item page.

A link (item) is captured once and can be source material of several incidents, in any projects
(capture.item_incidents). Who can see it: its submitter, global reviewers, and members of any project it is
used in. Its note and tags stay the submitter's own: other people see the captures, not those.
"""

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
       (SELECT coalesce(json_agg(json_build_object(
                 'id', inc.id, 'slug', pr.code || '-' || inc.number, 'description', inc.description,
                 'project_id', pr.id, 'color', pr.color, 'added_at', ii.added_at) ORDER BY ii.added_at), '[]')
          FROM capture.item_incidents ii JOIN capture.incidents inc ON inc.id = ii.incident_id AND NOT inc.deleted
          JOIN capture.projects pr ON pr.id = inc.project_id WHERE ii.item_id = i.id) AS incidents
  FROM capture.items i
  LEFT JOIN capture.contributors c ON c.id = i.submitted_by
  LEFT JOIN capture.captures lc ON lc.id = i.latest_capture_id
"""


def project_ids(r: dict) -> list[str]:
    return list(dict.fromkeys(str(x["project_id"]) for x in (r.get("incidents") or [])))


def item_json(r: dict, p: Principal | None = None, visible_projects: set[str] | None = None) -> dict:
    """`p`: the viewer. Notes/tags are shown only to the submitter and global reviewers; incidents only in
    projects the viewer can see (`visible_projects`, None = all)."""
    own = p is None or p.at_least("reviewer") or str(r["submitted_by"]) == p.contributor_id
    incidents = [{**x, "id": str(x["id"]), "project_id": str(x["project_id"])} for x in (r.get("incidents") or [])
                 if visible_projects is None or str(x["project_id"]) in visible_projects]
    return {
        "id": str(r["id"]), "url": r["submitted_url"], "canonical_url": r["canonical_url"],
        "resolved_url": r["resolved_url"], "platform": r["platform"], "kind": r["kind"], "status": r["status"],
        "title": r["title"], "note": r["note"] if own else None, "case_ref": r["case_ref"] if own else None,
        "tags": r["tags"] if own else [], "sensitive": r["sensitive"], "client": r["client"],
        "created_at": r["created_at"],
        "submitted_by": {"id": str(r["submitted_by"]) if r["submitted_by"] else None,
                         "name": r.get("submitted_by_name")},
        "incidents": incidents,
        "latest_capture": None if not r.get("capture_state") else {
            "id": str(r["latest_capture_id"]), "state": r["capture_state"], "verdict": r["verdict"],
            "reasons": r["verdict_reasons"], "extracted": r["extracted"], "captured_at": r["captured_at"],
            "manifest_sha256": r["manifest_sha256"],
        },
    }


async def visible_projects(conn, p: Principal, r: dict) -> set[str]:
    """Which of the item's projects the viewer belongs to."""
    out = set()
    for pid in project_ids(r):
        if await project_role(conn, p, pid) is not None:
            out.add(pid)
    return out


async def intake_role(conn, p: Principal, item_id, roles: tuple = ("viewer", "editor", "manager", "owner")) -> bool:
    """A link that came in with a community submission is visible to the members (viewer and up) of the project
    the submission is routed to, before anyone files it (intake.py)."""
    return bool(await (await conn.execute(
        "SELECT 1 FROM capture.intake_items ii JOIN capture.intake k ON k.id = ii.intake_id"
        " JOIN capture.project_members m ON m.project_id = k.project_id"
        " WHERE ii.item_id = %s AND m.contributor_id = %s AND m.role = ANY(%s) LIMIT 1",
        (item_id, p.contributor_id, list(roles)))).fetchone())


async def can_see_item(conn, p: Principal, r: dict) -> bool:
    if p.at_least("reviewer") or str(r["submitted_by"]) == p.contributor_id:
        return True
    return bool(await visible_projects(conn, p, r)) or await intake_role(conn, p, r["id"])


async def item_json_for(conn, p: Principal, r: dict) -> dict:
    vis = None if p.role == "admin" else await visible_projects(conn, p, r)
    return item_json(r, p, vis)


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


async def _writable_incident(conn, p: Principal, incident_id) -> dict:
    inc = await (await conn.execute(
        "SELECT i.id, i.project_id, p.archived FROM capture.incidents i JOIN capture.projects p ON p.id = i.project_id"
        " WHERE i.id = %s AND NOT i.deleted", (incident_id,))).fetchone()
    if not inc:
        raise HTTPException(404, "incident not found")
    await require_project(conn, p, inc["project_id"], "editor")
    if inc["archived"]:
        raise HTTPException(409, "the project is archived")
    return inc


async def link_item(conn, p: Principal, item_id, incident_id) -> bool:
    """File an item under an incident (editor of that incident's project). False if it already was."""
    await _writable_incident(conn, p, incident_id)
    cur = await conn.execute("INSERT INTO capture.item_incidents (item_id, incident_id, added_by) VALUES (%s,%s,%s)"
                             " ON CONFLICT DO NOTHING", (item_id, incident_id, p.contributor_id))
    if not cur.rowcount:
        return False
    await add_update(conn, incident_id=incident_id, kind="material_added", p=p, item_id=item_id)
    await conn.execute("UPDATE capture.incidents SET updated_at = now() WHERE id = %s", (incident_id,))
    from .external import queue_wayback  # local import: external imports this module
    await queue_wayback(conn, item_id)
    from .publish import refresh_for_incidents   # local import: publish imports this module
    await refresh_for_incidents(conn, [incident_id])
    return True


async def unlink_item(conn, p: Principal, item_id, incident_id) -> bool:
    await _writable_incident(conn, p, incident_id)
    cur = await conn.execute("DELETE FROM capture.item_incidents WHERE item_id = %s AND incident_id = %s",
                             (item_id, incident_id))
    if not cur.rowcount:
        return False
    await add_update(conn, incident_id=incident_id, kind="material_removed", p=p, item_id=item_id)
    await conn.execute("UPDATE capture.incidents SET updated_at = now() WHERE id = %s", (incident_id,))
    return True


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
        await _writable_incident(conn, p, incident_id)

    # Serialise concurrent saves of the same link (double taps, two people at once).
    await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (canonical,))
    existing = await (await conn.execute(
        ITEM_SELECT + " WHERE i.canonical_url = %s OR i.resolved_url = %s ORDER BY i.created_at DESC LIMIT 1",
        (canonical, canonical))).fetchone()

    if existing:
        # Already saved: the same link (and its captures) is also filed under this incident.
        added = bool(incident_id) and await link_item(conn, p, existing["id"], incident_id)
        if new_version and existing["capture_state"] not in ("queued", "running"):
            await new_capture(conn, existing["id"], p)
        existing = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s", (existing["id"],))).fetchone()
        if await can_see_item(conn, p, existing):
            item = await item_json_for(conn, p, existing)
        else:
            # Saved by someone else, in their private inbox or projects you aren't in: say only that it exists.
            item = {"id": str(existing["id"]), "canonical_url": existing["canonical_url"],
                    "platform": existing["platform"], "kind": existing["kind"], "status": existing["status"],
                    "created_at": existing["created_at"], "latest_capture": None, "incidents": [], "visible": False,
                    "submitted_by": {"id": str(existing["submitted_by"]) if existing["submitted_by"] else None,
                                     "name": existing.get("submitted_by_name")}}
        return 200, {"created": False, "duplicate": True, "new_version": new_version, "linked": added, "item": item}

    row = await (await conn.execute(
        "INSERT INTO capture.items (submitted_url, submitted_text, canonical_url, platform, kind, title, note,"
        " case_ref, tags, sensitive, client, submitted_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id",
        (submitted, text, canonical, cls.platform, cls.kind, title, note, case_ref,
         [t.strip()[:60] for t in (tags or []) if t.strip()], sensitive, client, p.contributor_id))).fetchone()
    await new_capture(conn, row["id"], p)
    if incident_id:
        await link_item(conn, p, row["id"], incident_id)
    item = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s", (row["id"],))).fetchone()
    return 201, {"created": True, "duplicate": False, "new_version": False, "linked": bool(incident_id),
                 "item": item_json(item, p)}

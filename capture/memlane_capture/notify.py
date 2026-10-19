"""Notifications, after Atlos: you get one when an incident you follow changes.

You follow (are subscribed to) an incident automatically when you create it, comment on it, change it or add
material to it, and when someone assigns you. You can also follow or unfollow it by hand. Being @mentioned
in a comment notifies you even if you don't follow it, and so does a role tag (@reviewer, @manager, @editor, @owner,
@all, or their Vietnamese forms @nguoiduyet, @quanly, @bientap, @chusohuu, @tatca) for the members it covers. Nobody is notified of their own actions, and only
people who may see the incident's feed are notified (data-only viewers and removed members are not).
"""

import re

AUTO_SUBSCRIBE_KINDS = {"created", "comment", "attribute", "material_added"}


def find_mentions(body: str, people: list[tuple[str, str]]) -> set[str]:
    """Ids of people mentioned as "@Display Name" (case-insensitive, whole name, longest names first)."""
    found, text = set(), (body or "").lower()
    for pid, name in sorted(people, key=lambda x: -len(x[1] or "")):
        n = (name or "").strip().lower()
        if n and re.search(r"(^|[^\w])@" + re.escape(n) + r"(?!\w)", text):
            found.add(pid)
            text = text.replace("@" + n, " ")  # so "@Lan" doesn't also match inside "@Lan Anh"
    return found


# Role tags, in English and Vietnamese (without diacritics, so they're easy to type): "@reviewer" reaches everyone
# who can approve a publication in the project (managers, owners, members with publication access).
ROLE_TAGS = {
    "reviewer": "reviewer", "nguoiduyet": "reviewer", "duyet": "reviewer",
    "manager": "manager", "quanly": "manager",
    "editor": "editor", "bientap": "editor",
    "owner": "owner", "chusohuu": "owner",
    "all": "all", "everyone": "all", "tatca": "all",
}


def find_role_tags(body: str) -> set[str]:
    return {ROLE_TAGS[m.lower()] for m in re.findall(r"(?:^|[^\w])@([A-Za-z]+)(?![\w])", body or "") if m.lower() in ROLE_TAGS}


async def members_for_tags(conn, project_id, tags: set[str]) -> set[str]:
    """Members of the project matching role tags (never data-only viewers)."""
    if not tags:
        return set()
    conds = []
    if "all" in tags:
        conds.append("TRUE")
    if "reviewer" in tags:
        conds.append("(m.role IN ('manager', 'owner') OR m.can_publish)")
    if "manager" in tags:
        conds.append("m.role IN ('manager', 'owner')")
    if "editor" in tags:
        conds.append("m.role IN ('editor', 'manager', 'owner')")
    if "owner" in tags:
        conds.append("m.role = 'owner'")
    rows = await (await conn.execute(
        "SELECT m.contributor_id FROM capture.project_members m JOIN capture.contributors c ON c.id = m.contributor_id"
        f" WHERE m.project_id = %s AND m.role <> 'data_only_viewer' AND c.disabled_at IS NULL AND ({' OR '.join(conds)})",
        (project_id,))).fetchall()
    return {str(r["contributor_id"]) for r in rows}


async def mentioned_in(conn, project_id, body: str) -> set[str]:
    """Everyone a text tags: "@Display Name" or a role tag."""
    out = await members_for_tags(conn, project_id, find_role_tags(body))
    if body and "@" in body:
        people = await (await conn.execute(
            "SELECT id, display_name FROM capture.contributors WHERE disabled_at IS NULL")).fetchall()
        out |= find_mentions(body, [(str(x["id"]), x["display_name"]) for x in people])
    return out


async def notify_people(conn, *, update_id, ids, reason: str, actor_id: str | None, project_id) -> None:
    """Notify specific people of an update (e.g. a review request), only if they may see the project."""
    ids = [i for i in set(ids) if i and i != actor_id]
    if not ids:
        return
    await conn.execute(
        "INSERT INTO capture.notifications (contributor_id, update_id, reason)"
        " SELECT c.id, %s, %s FROM capture.contributors c WHERE c.id = ANY(%s::uuid[]) AND c.disabled_at IS NULL"
        " AND (c.role = 'admin' OR EXISTS (SELECT 1 FROM capture.project_members m WHERE m.project_id = %s"
        "      AND m.contributor_id = c.id AND m.role <> 'data_only_viewer'))"
        " ON CONFLICT DO NOTHING", (update_id, reason, ids, project_id))


async def subscribe(conn, contributor_id, incident_id) -> None:
    await conn.execute("INSERT INTO capture.subscriptions (contributor_id, incident_id) VALUES (%s, %s)"
                       " ON CONFLICT DO NOTHING", (contributor_id, incident_id))


async def fan_out(conn, *, update_id, incident_id, kind: str, actor_id: str | None, field: str | None,
                  old, new, body: str | None) -> None:
    if actor_id and kind in AUTO_SUBSCRIBE_KINDS:
        await subscribe(conn, actor_id, incident_id)

    reasons: dict[str, str] = {}
    for r in await (await conn.execute("SELECT contributor_id FROM capture.subscriptions WHERE incident_id = %s",
                                       (incident_id,))).fetchall():
        reasons[str(r["contributor_id"])] = "subscribed"
    if kind == "attribute" and field == "assignees":
        for a in set(new or []) - set(old or []):
            reasons[str(a)] = "assigned"
            await subscribe(conn, a, incident_id)
    if kind == "comment" and body and "@" in body:
        proj = await (await conn.execute("SELECT project_id FROM capture.incidents WHERE id = %s",
                                         (incident_id,))).fetchone()
        for pid in await mentioned_in(conn, proj["project_id"], body):
            reasons[pid] = "mentioned"
    reasons.pop(str(actor_id) if actor_id else "", None)
    if not reasons:
        return
    ids, why = list(reasons), [reasons[i] for i in reasons]
    # Only people who can see this incident's feed: members above data-only, or instance admins.
    await conn.execute(
        "INSERT INTO capture.notifications (contributor_id, update_id, reason)"
        " SELECT r.id, %s, r.reason FROM unnest(%s::uuid[], %s::text[]) AS r(id, reason)"
        " JOIN capture.contributors c ON c.id = r.id AND c.disabled_at IS NULL"
        " WHERE c.role = 'admin' OR EXISTS (SELECT 1 FROM capture.project_members m"
        "   JOIN capture.incidents i ON i.project_id = m.project_id"
        "   WHERE i.id = %s AND m.contributor_id = r.id AND m.role <> 'data_only_viewer')"
        " ON CONFLICT DO NOTHING",
        (update_id, ids, why, incident_id))

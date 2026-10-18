"""Notifications, after Atlos: you get one when an incident you follow changes.

You follow (are subscribed to) an incident automatically when you create it, comment on it, change it or add
material to it, and when someone assigns you. You can also follow or unfollow it by hand. Being @mentioned
in a comment notifies you even if you don't follow it. Nobody is notified of their own actions, and only
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
        people = await (await conn.execute(
            "SELECT id, display_name FROM capture.contributors WHERE disabled_at IS NULL")).fetchall()
        for pid in find_mentions(body, [(str(x["id"]), x["display_name"]) for x in people]):
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

"""Per-project access, after Atlos.

Two layers:
  * the instance (global) role on `contributors.role`. `admin` acts as owner of every project and manages
    people; `editor` may create projects (Atlos "trusted"); `reviewer` may see every inbox item; everyone
    else is a regular contributor.
  * the project role on `project_members.role`. This decides what someone can do inside a project:

    data_only_viewer  view incidents and source material only: no feed, comments, members or assignees
    viewer            + comments, the feed, the member list, CSV export
    editor            + create/edit incidents (not completed/cancelled ones), add and file source material
    manager           + completed/cancelled, edit those, delete incidents, project settings, bulk import
    owner             + members, roles, invite links, archive the project

A project you are not a member of does not exist for you (404, never 403), so its name doesn't leak.
"""

from fastapi import HTTPException

from .auth import Principal

PROJECT_ROLES = ["data_only_viewer", "viewer", "editor", "manager", "owner"]
RANK = {r: i for i, r in enumerate(PROJECT_ROLES)}


def at_least(role: str | None, minimum: str) -> bool:
    return role is not None and RANK[role] >= RANK[minimum]


async def project_role(conn, p: Principal, project_id) -> str | None:
    if p.role == "admin":
        return "owner"
    if not project_id:
        return None
    r = await (await conn.execute(
        "SELECT role FROM capture.project_members WHERE project_id = %s AND contributor_id = %s",
        (project_id, p.contributor_id))).fetchone()
    return r["role"] if r else None


async def require_project(conn, p: Principal, project_id, minimum: str = "data_only_viewer") -> str:
    role = await project_role(conn, p, project_id)
    if role is None:
        raise HTTPException(404, "project not found")
    if not at_least(role, minimum):
        raise HTTPException(403, f"requires the {minimum} role in this project")
    return role


def visible_projects_sql(p: Principal, alias: str = "pr") -> tuple[str, list]:
    """SQL condition limiting rows to projects `p` belongs to (everything for admins)."""
    if p.role == "admin":
        return "TRUE", []
    return (f"EXISTS (SELECT 1 FROM capture.project_members m WHERE m.project_id = {alias}.id"
            f" AND m.contributor_id = %s)", [p.contributor_id])

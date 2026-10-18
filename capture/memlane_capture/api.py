"""HTTP API for the save-from-anywhere entry points (share sheet, extension, bot) and the workspace.

    uvicorn memlane_capture.api:app --host 0.0.0.0 --port 8700
"""

import logging
import pathlib
import re
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, workspace
from .auth import Principal, current_principal, require
from .config import settings
from .db import make_pool, migrate
from .inbox_core import ITEM_SELECT, add_update, item_json, new_capture, save_link
from .signing import artifact_url, verify
from .storage import get_storage, iter_chunks

log = logging.getLogger("memlane.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = make_pool(max_size=10)
    await app.state.pool.open()
    await migrate(app.state.pool)
    yield
    await app.state.pool.close()


app = FastAPI(title="MemoryLane capture", version=__version__, lifespan=lifespan)
app.include_router(workspace.router)

# The workspace UI: static files, no build step (memlane_capture/web).
WEB_DIR = pathlib.Path(__file__).resolve().parent / "web"
app.mount("/app", StaticFiles(directory=WEB_DIR, html=True), name="app")
_APP_CSP = ("default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; script-src 'self'; "
            "style-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
            "form-action 'self'")

# Artifacts are hostile content. Every response is sandboxed (opaque origin, no scripts), and may not
# fetch anything: captured HTML renders from its own markup only, so opening it never pings the
# platform or a tracker. The UI additionally embeds HTML in <iframe sandbox>.
_ARTIFACT_CSP = ("sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; "
                 "font-src data:")


@app.middleware("http")
async def app_security_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/app"):
        response.headers["Content-Security-Policy"] = _APP_CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
    return response


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse("/app/")


if settings.cors_origins:
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["GET", "POST", "PATCH"],
                       allow_headers=["Authorization", "Content-Type"])


class InboxIn(BaseModel):
    url: str | None = Field(None, max_length=4000, description="The link. Either this or `text`.")
    text: str | None = Field(None, max_length=10000, description="Shared text containing the link (share sheets).")
    title: str | None = Field(None, max_length=500)
    note: str | None = Field(None, max_length=5000)
    case_ref: str | None = Field(None, max_length=100)
    tags: list[str] = Field(default_factory=list, max_length=30)
    sensitive: bool = False
    client: Literal["web", "android-share", "ios-shortcut", "extension", "telegram", "api", "import"] = "api"
    new_version: bool = Field(False, description="Already saved? Capture it again as a new version.")
    incident_id: str | None = Field(None, description="File it under this incident (source material).")


class ItemPatch(BaseModel):
    title: str | None = Field(None, max_length=500)
    note: str | None = Field(None, max_length=5000)
    case_ref: str | None = Field(None, max_length=100)
    tags: list[str] | None = Field(None, max_length=30)
    sensitive: bool | None = None
    incident_id: str | None = Field(None, description="Attach to an incident; null detaches.")


async def _get_item(conn, item_id: str, p: Principal) -> dict:
    """Visible to its submitter, to reviewers, and to everyone once it is source material of an incident."""
    r = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s", (item_id,))).fetchone()
    if not r or (not p.at_least("reviewer") and str(r["submitted_by"]) != p.contributor_id
                 and not r["incident_id"]):
        raise HTTPException(404, "item not found")
    return r


@app.get("/healthz")
async def healthz(request: Request):
    async with request.app.state.pool.connection() as conn:
        q = await (await conn.execute(
            "SELECT count(*) FILTER (WHERE state = 'queued') AS queued,"
            " count(*) FILTER (WHERE state = 'running') AS running FROM capture.captures")).fetchone()
    return {"ok": True, "version": __version__, **q}


@app.get("/v1/me")
async def me(p: Principal = Depends(current_principal)):
    return {"id": p.contributor_id, "name": p.display_name, "role": p.role, "token": p.token_label}


@app.post("/v1/inbox", status_code=201)
async def inbox(body: InboxIn, request: Request, response: Response,
                p: Principal = Depends(require("contributor"))):
    """Save a link. Replies at once; the capture runs in the background.

    Returns `{created, duplicate, new_version, item}`. A link already saved is
    not captured again unless `new_version` is true (and none is in progress);
    the existing item is returned so the client can say "already saved by X".
    """
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            status, res = await save_link(conn, p, url=body.url, text=body.text, title=body.title, note=body.note,
                                          case_ref=body.case_ref, tags=body.tags, sensitive=body.sensitive,
                                          client=body.client, new_version=body.new_version,
                                          incident_id=body.incident_id)
    response.status_code = status
    return res


@app.get("/v1/items")
async def list_items(request: Request, p: Principal = Depends(current_principal),
                     mine: bool = True, status: str | None = None, unfiled: bool = False,
                     limit: int = Query(50, ge=1, le=200), before: str | None = None):
    where, args = [], []
    if mine or not p.at_least("reviewer"):
        where.append("i.submitted_by = %s")
        args.append(p.contributor_id)
    if status:
        where.append("i.status = %s")
        args.append(status)
    if unfiled:
        where.append("i.incident_id IS NULL")
    if before:
        where.append("i.created_at < %s::timestamptz")
        args.append(before)
    sql = ITEM_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY i.created_at DESC LIMIT %s"
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(sql, (*args, limit))).fetchall()
    return {"items": [item_json(r) for r in rows]}


@app.get("/v1/items/{item_id}")
async def get_item(item_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        item = item_json(await _get_item(conn, item_id, p))
        caps = await (await conn.execute(
            "SELECT id, state, verdict, verdict_reasons, attempts, created_at, started_at, finished_at, final_url,"
            " extracted, witnesses, tool_versions, manifest_sha256, error FROM capture.captures WHERE item_id = %s"
            " ORDER BY created_at DESC", (item_id,))).fetchall()
        arts = await (await conn.execute(
            "SELECT a.id, a.capture_id, a.witness, a.kind, a.role, a.label, a.sha256, a.bytes, a.mime, a.source_url,"
            " a.width, a.height, a.duration_s FROM capture.artifacts a JOIN capture.captures c ON c.id = a.capture_id"
            " WHERE c.item_id = %s ORDER BY a.role DESC, a.kind, a.label", (item_id,))).fetchall()
    by_cap: dict[str, list] = {}
    for a in arts:
        a = {**a, "id": str(a["id"]), "capture_id": str(a["capture_id"]),
             "url": a["source_url"] if a["kind"] == "link" else artifact_url(a["id"])}
        by_cap.setdefault(a["capture_id"], []).append(a)
    item["captures"] = [{**c, "id": str(c["id"]), "artifacts": by_cap.get(str(c["id"]), [])} for c in caps]
    return item


@app.patch("/v1/items/{item_id}")
async def patch_item(item_id: str, body: ItemPatch, request: Request, p: Principal = Depends(current_principal)):
    changes = body.model_dump(exclude_unset=True)
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            r = await _get_item(conn, item_id, p)
            own = str(r["submitted_by"]) == p.contributor_id
            moving = "incident_id" in changes and str(changes["incident_id"] or "") != str(r["incident_id"] or "")
            # Filing material under an incident is open to every contributor (Atlos "add material");
            # editing someone else's notes is not.
            if (set(changes) - {"incident_id"}) and not own and not p.at_least("editor"):
                raise HTTPException(403, "only the submitter or an editor can edit this item")
            if moving and changes["incident_id"]:
                inc = await (await conn.execute(
                    "SELECT 1 FROM capture.incidents i JOIN capture.projects pr ON pr.id = i.project_id"
                    " WHERE i.id = %s AND NOT i.deleted AND NOT pr.archived", (changes["incident_id"],))).fetchone()
                if not inc:
                    raise HTTPException(404, "incident not found or its project is archived")
            if changes:
                cols = ", ".join(f"{k} = %s" for k in changes)
                await conn.execute(f"UPDATE capture.items SET {cols}, updated_at = now() WHERE id = %s",
                                   (*changes.values(), item_id))
            if moving:
                if r["incident_id"]:
                    await add_update(conn, incident_id=r["incident_id"], kind="material_removed", p=p, item_id=item_id)
                if changes["incident_id"]:
                    await add_update(conn, incident_id=changes["incident_id"], kind="material_added", p=p,
                                     item_id=item_id)
        return item_json(await _get_item(conn, item_id, p))


@app.post("/v1/items/{item_id}/recapture", status_code=202)
async def recapture(item_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        r = await _get_item(conn, item_id, p)
        if r["capture_state"] in ("queued", "running"):
            raise HTTPException(409, "a capture of this item is already in progress")
        cap_id = await new_capture(conn, item_id, p)
    return {"capture_id": cap_id}


_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


@app.get("/v1/artifacts/{artifact_id}")
async def get_artifact(artifact_id: str, request: Request, exp: str | None = None, sig: str | None = None):
    """The stored file. Auth: a Bearer token that may see the item, or a signed URL from an item response."""
    async with request.app.state.pool.connection() as conn:
        a = await (await conn.execute(
            "SELECT a.*, i.id AS item_id FROM capture.artifacts a JOIN capture.captures c ON c.id = a.capture_id"
            " JOIN capture.items i ON i.id = c.item_id WHERE a.id = %s", (artifact_id,))).fetchone()
        if not a:
            raise HTTPException(404, "artifact not found")
        if not verify(artifact_id, exp, sig):
            await _get_item(conn, a["item_id"], await current_principal(request))
    if a["kind"] == "link":
        return RedirectResponse(a["source_url"])

    size = a["bytes"] or get_storage().size(a["storage_key"])
    headers = {"X-Content-SHA256": a["sha256"], "Cache-Control": "private, max-age=21600",
               "Content-Security-Policy": _ARTIFACT_CSP, "X-Content-Type-Options": "nosniff",
               "Cross-Origin-Resource-Policy": "same-origin", "Accept-Ranges": "bytes",
               "Content-Disposition": "inline"}
    mime = a["mime"] or "application/octet-stream"
    if mime.startswith("text/") and "charset" not in mime:
        mime += "; charset=utf-8"
    m = _RANGE.match(request.headers.get("range", ""))
    if m and (m.group(1) or m.group(2)):
        # Single byte range, so <video> can seek and start without downloading the whole file.
        if m.group(1):
            start, end = int(m.group(1)), min(int(m.group(2) or size - 1), size - 1)
        else:
            start, end = max(0, size - int(m.group(2))), size - 1
        if start > end or start >= size:
            raise HTTPException(416, headers={"Content-Range": f"bytes */{size}"})
        headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(end - start + 1)})
        f = get_storage().open(a["storage_key"], start, end)
        return StreamingResponse(iter_chunks(f, end - start + 1), status_code=206, media_type=mime, headers=headers)
    headers["Content-Length"] = str(size)
    return StreamingResponse(iter_chunks(get_storage().open(a["storage_key"])), media_type=mime, headers=headers)

"""HTTP API for the save-from-anywhere entry points (share sheet, extension, bot) and the workspace.

    uvicorn memlane_capture.api:app --host 0.0.0.0 --port 8700
"""

import hashlib
import logging
import pathlib
from contextlib import asynccontextmanager
from urllib.parse import urlsplit
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from . import __version__, health, intake, people, publish, workspace
from .auth import Principal, current_principal, require
from .config import settings
from .db import make_pool, migrate
from .access import project_role, require_project
from .external import queue_wayback
from .inbox_core import (ITEM_SELECT, add_update, can_see_item, intake_role, item_json, item_json_for, link_item, new_capture,
                         project_ids, save_link, unlink_item)
from .serve import stored_response
from .signing import artifact_url, timestamp_url, verify

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
app.include_router(people.router)
app.include_router(intake.router)
app.include_router(intake.spoke)
app.include_router(publish.router)
app.include_router(health.router)

# The workspace UI: static files, no build step (memlane_capture/web).
WEB_DIR = pathlib.Path(__file__).resolve().parent / "web"
_web = StaticFiles(directory=WEB_DIR, html=True)
# Scripts and styles are served under /app/b/<build>/, a hash of the UI files, so a deploy changes every URL and
# no browser or CDN can keep running the previous UI (Cloudflare imposes its own browser cache on .js/.css).
# Only index.html names the build; modules import each other relatively and inherit it.
WEB_BUILD = hashlib.sha256(b"".join(p.relative_to(WEB_DIR).as_posix().encode() + p.read_bytes()
                                    for p in sorted(WEB_DIR.rglob("*")) if p.is_file())).hexdigest()[:12]
_INDEX = ((WEB_DIR / "index.html").read_text(encoding="utf-8")
          .replace('href="app.css"', f'href="b/{WEB_BUILD}/app.css"')
          .replace('src="js/main.js"', f'src="b/{WEB_BUILD}/js/main.js"'))


@app.get("/app/", include_in_schema=False)
@app.get("/app/index.html", include_in_schema=False)
async def app_index():
    return HTMLResponse(_INDEX)


@app.get("/app/b/{build}/{path:path}", include_in_schema=False)
async def app_build_file(build: str, path: str, request: Request):
    response = await _web.get_response(path, request.scope)
    if build == WEB_BUILD and response.status_code == 200:
        response.headers["X-Immutable"] = "1"   # read by app_security_headers
    return response


app.mount("/app", _web, name="app")
if settings.feed_serve_local:
    # Development only: in production the feed is served from its public bucket (FEED_PUBLIC_URL).
    pathlib.Path(settings.feed_dir).mkdir(parents=True, exist_ok=True)
    app.mount("/feed", StaticFiles(directory=settings.feed_dir), name="feed")
# Map tiles come from the configured tile server (config.tile_url); nothing else external is allowed.
# A "{s}" subdomain placeholder (a/b/c/d.basemaps.cartocdn.com) becomes a wildcard for that host only.
_TILE_ORIGIN = "{0.scheme}://{0.netloc}".format(urlsplit(settings.tile_url)).replace("{s}", "*")
_APP_CSP = (f"default-src 'self'; img-src 'self' blob: data: {_TILE_ORIGIN}; media-src 'self' blob:; script-src 'self'; "
            "style-src 'self'; connect-src 'self'; frame-src 'self'; frame-ancestors 'none'; base-uri 'none'; "
            "form-action 'self'")

@app.middleware("http")
async def app_security_headers(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith("/app"):
        response.headers["Content-Security-Policy"] = _APP_CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Origin only (never paths): tile servers require a referrer under their usage policies.
        response.headers["Referrer-Policy"] = "strict-origin"
        # Files of the current build never change (their URL carries the build); everything else revalidates.
        immutable = "x-immutable" in response.headers
        if immutable:
            del response.headers["x-immutable"]
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if immutable else "no-cache"
    elif request.url.path.startswith("/feed/"):
        response.headers["Access-Control-Allow-Origin"] = "*"
        response.headers["Cache-Control"] = "no-cache"
        response.headers["X-Content-Type-Options"] = "nosniff"
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
    client: Literal["web", "android-share", "ios-shortcut", "extension", "telegram", "api", "import", "intake"] = "api"
    new_version: bool = Field(False, description="Already saved? Capture it again as a new version.")
    incident_id: str | None = Field(None, description="Also file it under this incident (source material).")


class ItemPatch(BaseModel):
    title: str | None = Field(None, max_length=500)
    note: str | None = Field(None, max_length=5000)
    case_ref: str | None = Field(None, max_length=100)
    tags: list[str] | None = Field(None, max_length=30)
    sensitive: bool | None = None


class CorrectionIn(BaseModel):
    """Fields left out stay as they are; an empty string clears a correction (back to what the machine found)."""
    title: str | None = Field(None, max_length=500)
    author: str | None = Field(None, max_length=300)
    published_at: str | None = Field(None, pattern=r"^$|^\d{4}-\d{2}-\d{2}$")
    text: str | None = Field(None, max_length=10000)
    status: Literal["", "complete", "partial", "walled", "restricted", "unavailable", "failed"] | None = None
    reason: str | None = Field(None, max_length=2000)


class LinkIn(BaseModel):
    incident_id: str


async def _get_item(conn, item_id: str, p: Principal) -> dict:
    """Visible to its submitter, global reviewers, and members of any project it is used in."""
    r = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s", (item_id,))).fetchone()
    if not r or not await can_see_item(conn, p, r):
        raise HTTPException(404, "item not found")
    return r


async def _can_edit_material(conn, p: Principal, r: dict) -> bool:
    """Re-capture / send to the Internet Archive: the submitter, global reviewers, editors of any project using it."""
    if p.at_least("reviewer") or str(r["submitted_by"]) == p.contributor_id:
        return True
    for pid in project_ids(r):
        if await project_role(conn, p, pid) in ("editor", "manager", "owner"):
            return True
    return await intake_role(conn, p, r["id"], ("editor", "manager", "owner"))


async def _wayback(conn, item_id) -> dict | None:
    e = await (await conn.execute("SELECT state, copy_url, error, submitted_url, created_at, finished_at FROM"
                                  " capture.external_copies WHERE item_id = %s AND service = 'wayback'"
                                  " ORDER BY created_at DESC LIMIT 1", (item_id,))).fetchone()
    return None if not e else {"state": e["state"], "url": e["copy_url"], "error": e["error"],
                               "submitted_url": e["submitted_url"], "requested_at": e["created_at"],
                               "finished_at": e["finished_at"]}


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


@app.get("/v1/config")
async def public_config():
    return {"tile_url": settings.tile_url, "tile_subdomains": settings.tile_subdomains,
            "tile_attribution": settings.tile_attribution,
            # lets tests (and the UI) know whether a Wayback request would really be submitted (publicly)
            "wayback_configured": bool(settings.ia_access_key and settings.ia_secret_key),
            # the replay viewer for captures' WACZ (replay.py), on its own origin; empty: not offered
            "replay_url": settings.replay_url}


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
        where.append("COALESCE(i.status_override, i.status) = %s")   # a person's correction wins
        args.append(status)
    if unfiled:
        where.append("NOT EXISTS (SELECT 1 FROM capture.item_incidents ii WHERE ii.item_id = i.id)")
    if before:
        where.append("i.created_at < %s::timestamptz")
        args.append(before)
    sql = ITEM_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY i.created_at DESC LIMIT %s"
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(sql, (*args, limit))).fetchall()
        return {"items": [await item_json_for(conn, p, r) for r in rows]}


@app.get("/v1/items/{item_id}")
async def get_item(item_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        item = await _item_out(conn, p, item_id)
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
    async with request.app.state.pool.connection() as conn:
        stamps = await (await conn.execute(
            "SELECT capture_id, tsa, state, gen_time, token_sha256 FROM capture.capture_timestamps"
            " WHERE capture_id = ANY(%s) ORDER BY gen_time NULLS LAST", ([c["id"] for c in caps],))).fetchall()
    by_cap_ts: dict[str, list] = {}
    for s in stamps:
        by_cap_ts.setdefault(str(s["capture_id"]), []).append({
            "authority": urlsplit(s["tsa"]).hostname, "state": s["state"], "time": s["gen_time"],
            "url": timestamp_url(s["token_sha256"]) if s["token_sha256"] else None})
    for c in item["captures"]:
        c["timestamps"] = by_cap_ts.get(c["id"], [])
    async with request.app.state.pool.connection() as conn:
        item["wayback"] = await _wayback(conn, item_id)
        item["can_edit"] = await _can_edit_material(conn, p, await _get_item(conn, item_id, p))
    return item


@app.patch("/v1/items/{item_id}/corrections")
async def correct_item(item_id: str, body: CorrectionIn, request: Request, p: Principal = Depends(current_principal)):
    """A person corrects what the machine got wrong: the status (a dropdown in the UI) and the metadata. The sealed
    captures are untouched; the correction is kept beside them, with who, when and why, and every change is logged."""
    sent = body.model_dump(exclude_unset=True)
    reason = (sent.pop("reason", None) or "").strip() or None
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            r = await _get_item(conn, item_id, p)
            if not await _can_edit_material(conn, p, r):
                raise HTTPException(403, "only the submitter or the project's editors can correct this")
            fields = dict(r["corrections"] or {})
            status = r["status_override"]
            changes = {}
            if "status" in sent:
                new = sent.pop("status") or None
                if new != status:
                    if new and not reason:
                        raise HTTPException(422, "say why the status is corrected")
                    changes["status"] = {"old": status or r["status"], "new": new or r["status"]}
                    status = new
            for k, v in sent.items():
                v = (v or "").strip() or None
                if v != fields.get(k):
                    changes[k] = {"old": fields.get(k), "new": v}
                    if v:
                        fields[k] = v
                    else:
                        fields.pop(k, None)
            if not changes:
                return await _item_out(conn, p, item_id)
            await conn.execute(
                "UPDATE capture.items SET status_override = %s, corrections = %s, corrected_by = %s, corrected_at = now(),"
                " correction_reason = COALESCE(%s, correction_reason), updated_at = now() WHERE id = %s",
                (status, Jsonb(fields), p.contributor_id, reason, item_id))
            await conn.execute("INSERT INTO capture.item_corrections (item_id, by_id, changes, reason) VALUES (%s,%s,%s,%s)",
                               (item_id, p.contributor_id, Jsonb(changes), reason))
            links = await (await conn.execute("SELECT incident_id FROM capture.item_incidents WHERE item_id = %s",
                                              (item_id,))).fetchall()
            for link in links:
                await add_update(conn, incident_id=link["incident_id"], kind="material_corrected", p=p, item_id=item_id,
                                 new={k: v["new"] for k, v in changes.items()}, body=reason)
            if links:
                from .publish import refresh_for_incidents   # a corrected status can change what a public version shows
                await refresh_for_incidents(conn, [x["incident_id"] for x in links])
        return await _item_out(conn, p, item_id)


async def _item_out(conn, p: Principal, item_id: str) -> dict:
    out = await item_json_for(conn, p, await _get_item(conn, item_id, p))
    hist = await (await conn.execute(
        "SELECT h.at, h.changes, h.reason, c.display_name AS by FROM capture.item_corrections h"
        " LEFT JOIN capture.contributors c ON c.id = h.by_id WHERE h.item_id = %s ORDER BY h.at DESC LIMIT 50",
        (item_id,))).fetchall()
    out["corrections_log"] = [dict(h) for h in hist]
    return out


@app.get("/v1/timestamps/{token_sha256}.tsr")
async def get_timestamp(token_sha256: str, request: Request, exp: str | None = None, sig: str | None = None):
    """A capture's RFC 3161 token (upkeep.py), for offline checking with `openssl ts -verify`."""
    async with request.app.state.pool.connection() as conn:
        t = await (await conn.execute(
            "SELECT t.token_key, t.token_sha256, c.item_id FROM capture.capture_timestamps t"
            " JOIN capture.captures c ON c.id = t.capture_id WHERE t.token_sha256 = %s", (token_sha256,))).fetchone()
        if not t:
            raise HTTPException(404, "timestamp not found")
        if not verify("ts:" + token_sha256, exp, sig):
            await _get_item(conn, t["item_id"], await current_principal(request))
    return stored_response(request, storage_key=t["token_key"], size=None, mime="application/timestamp-reply",
                           sha256=t["token_sha256"])


@app.get("/v1/similar-images")
async def similar_images(request: Request, item_id: str | None = None, intake_id: str | None = None,
                         p: Principal = Depends(current_principal)):
    """Photos already in the archive that look like this link's or this submission's (phash.py), among what
    the viewer may see. Same picture resized or recompressed: at most SIMILAR_BITS of 64 bits differ."""
    from .intake import _get_intake
    from .phash import SIMILAR_BITS
    async with request.app.state.pool.connection() as conn:
        if item_id:
            await _get_item(conn, item_id, p)
            hashes = [r["phash"] for r in await (await conn.execute(
                "SELECT a.phash FROM capture.artifacts a JOIN capture.captures c ON c.id = a.capture_id"
                " WHERE c.item_id = %s AND a.phash IS NOT NULL AND a.phash <> 0", (item_id,))).fetchall()]
        elif intake_id:
            await _get_intake(conn, intake_id, p)
            hashes = [r["phash"] for r in await (await conn.execute(
                "SELECT phash FROM capture.intake_files WHERE intake_id = %s AND phash IS NOT NULL AND phash <> 0",
                (intake_id,))).fetchall()]
        else:
            raise HTTPException(422, "item_id or intake_id")
        found: dict[tuple, int] = {}
        for h in set(hashes):
            for r in await (await conn.execute(
                    "SELECT 'item' AS type, c.item_id AS id, bit_count((a.phash # %s)::bit(64)) AS d"
                    "  FROM capture.artifacts a JOIN capture.captures c ON c.id = a.capture_id"
                    " WHERE a.phash IS NOT NULL AND a.phash <> 0 AND c.item_id IS DISTINCT FROM %s::uuid"
                    "   AND bit_count((a.phash # %s)::bit(64)) <= %s"
                    " UNION ALL "
                    "SELECT 'intake', f.intake_id, bit_count((f.phash # %s)::bit(64)) FROM capture.intake_files f"
                    " WHERE f.phash IS NOT NULL AND f.phash <> 0 AND f.intake_id IS DISTINCT FROM %s::uuid"
                    "   AND bit_count((f.phash # %s)::bit(64)) <= %s LIMIT 50",
                    (h, item_id, h, SIMILAR_BITS, h, intake_id, h, SIMILAR_BITS))).fetchall():
                key = (r["type"], str(r["id"]))
                found[key] = min(found.get(key, 99), r["d"])
        out = []
        for (kind, oid), d in sorted(found.items(), key=lambda x: x[1])[:20]:
            try:                                   # only what this person may see
                if kind == "item":
                    it = await _get_item(conn, oid, p)
                    out.append({"type": "item", "id": oid, "title": it["title"] or it["canonical_url"], "distance": d})
                else:
                    k, _ = await _get_intake(conn, oid, p)
                    pl = k["payload"] or {}
                    out.append({"type": "intake", "id": oid, "distance": d, "source": k["source_name"],
                                "title": (pl.get("title") or pl.get("text") or pl.get("note") or "")[:120]})
            except HTTPException:
                continue
    return {"similar": out[:10]}


@app.post("/v1/items/{item_id}/wayback", status_code=202)
async def request_wayback(item_id: str, request: Request, p: Principal = Depends(current_principal)):
    """Ask the Internet Archive for a public copy now, whatever the project's setting."""
    async with request.app.state.pool.connection() as conn:
        r = await _get_item(conn, item_id, p)
        if not await _can_edit_material(conn, p, r):
            raise HTTPException(403, "only the submitter or the project's editors can request this")
        await queue_wayback(conn, item_id, requested_by=p.contributor_id, force=True)
        return await _wayback(conn, item_id)


@app.patch("/v1/items/{item_id}")
async def patch_item(item_id: str, body: ItemPatch, request: Request, p: Principal = Depends(current_principal)):
    changes = body.model_dump(exclude_unset=True)
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            r = await _get_item(conn, item_id, p)
            # Notes and tags are the submitter's own (or a global editor's to fix).
            if changes and str(r["submitted_by"]) != p.contributor_id and not p.at_least("editor"):
                raise HTTPException(403, "only the submitter or an editor can edit this item")
            if changes:
                cols = ", ".join(f"{k} = %s" for k in changes)
                await conn.execute(f"UPDATE capture.items SET {cols}, updated_at = now() WHERE id = %s",
                                   (*changes.values(), item_id))
        return await item_json_for(conn, p, await _get_item(conn, item_id, p))


@app.post("/v1/items/{item_id}/incidents", status_code=201)
async def file_item(item_id: str, body: LinkIn, request: Request, p: Principal = Depends(current_principal)):
    """File a link under (another) incident: editor of that incident's project. A link can be in several."""
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            await _get_item(conn, item_id, p)
            added = await link_item(conn, p, item_id, body.incident_id)
        return {"added": added, "item": await item_json_for(conn, p, await _get_item(conn, item_id, p))}


@app.delete("/v1/items/{item_id}/incidents/{incident_id}")
async def unfile_item(item_id: str, incident_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            await _get_item(conn, item_id, p)
            removed = await unlink_item(conn, p, item_id, incident_id)
        r = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s", (item_id,))).fetchone()
        visible = await can_see_item(conn, p, r)
        return {"removed": removed, "item": await item_json_for(conn, p, r) if visible else None}


@app.post("/v1/items/{item_id}/recapture", status_code=202)
async def recapture(item_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        r = await _get_item(conn, item_id, p)
        if not await _can_edit_material(conn, p, r):
            raise HTTPException(403, "only the submitter or the project's editors can re-capture this")
        if r["capture_state"] in ("queued", "running"):
            raise HTTPException(409, "a capture of this item is already in progress")
        cap_id = await new_capture(conn, item_id, p)
    return {"capture_id": cap_id}


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
    return stored_response(request, storage_key=a["storage_key"], size=a["bytes"], mime=a["mime"], sha256=a["sha256"])

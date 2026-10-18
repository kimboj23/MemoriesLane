"""HTTP API for the save-from-anywhere entry points (share sheet, extension, bot) and the workspace.

    uvicorn memlane_capture.api:app --host 0.0.0.0 --port 8700
"""

import logging
import pathlib
from contextlib import asynccontextmanager
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__
from .auth import Principal, current_principal, require
from .config import settings
from .db import make_pool, migrate
from .storage import get_storage, iter_chunks
from .urls import canonicalize, classify, extract_url

log = logging.getLogger("memlane.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pool = make_pool(max_size=10)
    await app.state.pool.open()
    await migrate(app.state.pool)
    yield
    await app.state.pool.close()


app = FastAPI(title="MemoryLane capture", version=__version__, lifespan=lifespan)

# The test/workspace UI: static files, no build step (memlane_capture/web).
WEB_DIR = pathlib.Path(__file__).resolve().parent / "web"
app.mount("/app", StaticFiles(directory=WEB_DIR, html=True), name="app")
_APP_CSP = ("default-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; script-src 'self'; "
            "style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")


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


class ItemPatch(BaseModel):
    title: str | None = Field(None, max_length=500)
    note: str | None = Field(None, max_length=5000)
    case_ref: str | None = Field(None, max_length=100)
    tags: list[str] | None = Field(None, max_length=30)
    sensitive: bool | None = None


ITEM_SELECT = """
SELECT i.*, c.display_name AS submitted_by_name,
       lc.state AS capture_state, lc.verdict, lc.verdict_reasons, lc.extracted, lc.finished_at AS captured_at,
       lc.manifest_sha256
  FROM capture.items i
  LEFT JOIN capture.contributors c ON c.id = i.submitted_by
  LEFT JOIN capture.captures lc ON lc.id = i.latest_capture_id
"""


def _item_json(r: dict) -> dict:
    return {
        "id": str(r["id"]), "url": r["submitted_url"], "canonical_url": r["canonical_url"],
        "resolved_url": r["resolved_url"], "platform": r["platform"], "kind": r["kind"], "status": r["status"],
        "title": r["title"], "note": r["note"], "case_ref": r["case_ref"], "tags": r["tags"],
        "sensitive": r["sensitive"], "client": r["client"], "created_at": r["created_at"],
        "submitted_by": {"id": str(r["submitted_by"]) if r["submitted_by"] else None,
                         "name": r.get("submitted_by_name")},
        "latest_capture": None if not r.get("capture_state") else {
            "id": str(r["latest_capture_id"]), "state": r["capture_state"], "verdict": r["verdict"],
            "reasons": r["verdict_reasons"], "extracted": r["extracted"], "captured_at": r["captured_at"],
            "manifest_sha256": r["manifest_sha256"],
        },
    }


async def _get_item(conn, item_id: str, p: Principal) -> dict:
    r = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s", (item_id,))).fetchone()
    if not r or (not p.at_least("reviewer") and str(r["submitted_by"]) != p.contributor_id):
        raise HTTPException(404, "item not found")
    return r


async def _new_capture(conn, item_id, p: Principal) -> str:
    cap = await (await conn.execute(
        "INSERT INTO capture.captures (item_id, requested_by) VALUES (%s, %s) RETURNING id",
        (item_id, p.contributor_id))).fetchone()
    await conn.execute("UPDATE capture.items SET latest_capture_id = %s, status = 'queued', updated_at = now()"
                       " WHERE id = %s", (cap["id"], item_id))
    return str(cap["id"])


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

    Returns `{created, duplicate, item}`. A link someone already saved is not
    captured again unless `new_version` is true; the existing item is returned
    so the client can say "already saved by X, view it / save a new version".
    """
    submitted = (body.url or "").strip() or extract_url(body.text or "")
    if submitted and not submitted.lower().startswith(("http://", "https://")):
        submitted = extract_url(submitted)
    if not submitted:
        raise HTTPException(422, "no http(s) link found in url/text")
    canonical = canonicalize(submitted)
    cls = classify(canonical)

    async with request.app.state.pool.connection() as conn:
        recent = await (await conn.execute(
            "SELECT count(*) AS n FROM capture.items WHERE submitted_by = %s AND created_at > now() - interval '1 hour'",
            (p.contributor_id,))).fetchone()
        if recent["n"] >= settings.submit_rate_per_hour:
            raise HTTPException(429, "too many links this hour, try again later")

        async with conn.transaction():
            # Serialise concurrent saves of the same link (double taps, two people at once).
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (canonical,))
            existing = await (await conn.execute(
                ITEM_SELECT + " WHERE i.canonical_url = %s OR i.resolved_url = %s ORDER BY i.created_at DESC LIMIT 1",
                (canonical, canonical))).fetchone()
            if existing:
                # A repeat (double tap, or someone else saved it first) just returns the existing item.
                response.status_code = 200
                if body.new_version:
                    # Explicitly asked to capture again. If a capture is already queued/running, that one
                    # is the new version: never stack duplicates.
                    if existing["capture_state"] not in ("queued", "running"):
                        await _new_capture(conn, existing["id"], p)
                        existing = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s",
                                                             (existing["id"],))).fetchone()
                    return {"created": False, "duplicate": True, "new_version": True, "item": _item_json(existing)}
                # Visible to the submitter as "already saved": reveal only who, not their notes, unless reviewer.
                item = _item_json(existing)
                if not p.at_least("reviewer") and str(existing["submitted_by"]) != p.contributor_id:
                    item = {k: item[k] for k in ("id", "canonical_url", "platform", "kind", "status", "title",
                                                 "created_at", "submitted_by", "latest_capture")}
                return {"created": False, "duplicate": True, "new_version": False, "item": item}

            row = await (await conn.execute(
                "INSERT INTO capture.items (submitted_url, submitted_text, canonical_url, platform, kind, title, note,"
                " case_ref, tags, sensitive, client, submitted_by) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)"
                " RETURNING id",
                (submitted, body.text, canonical, cls.platform, cls.kind, body.title, body.note, body.case_ref,
                 [t.strip()[:60] for t in body.tags if t.strip()], body.sensitive, body.client,
                 p.contributor_id))).fetchone()
            await _new_capture(conn, row["id"], p)
            item = await (await conn.execute(ITEM_SELECT + " WHERE i.id = %s", (row["id"],))).fetchone()
    return {"created": True, "duplicate": False, "new_version": False, "item": _item_json(item)}


@app.get("/v1/items")
async def list_items(request: Request, p: Principal = Depends(current_principal),
                     mine: bool = True, status: str | None = None,
                     limit: int = Query(50, ge=1, le=200), before: str | None = None):
    where, args = [], []
    if mine or not p.at_least("reviewer"):
        where.append("i.submitted_by = %s")
        args.append(p.contributor_id)
    if status:
        where.append("i.status = %s")
        args.append(status)
    if before:
        where.append("i.created_at < %s::timestamptz")
        args.append(before)
    sql = ITEM_SELECT + (" WHERE " + " AND ".join(where) if where else "") + " ORDER BY i.created_at DESC LIMIT %s"
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(sql, (*args, limit))).fetchall()
    return {"items": [_item_json(r) for r in rows]}


@app.get("/v1/items/{item_id}")
async def get_item(item_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        item = _item_json(await _get_item(conn, item_id, p))
        caps = await (await conn.execute(
            "SELECT id, state, verdict, verdict_reasons, attempts, created_at, started_at, finished_at, final_url,"
            " witnesses, tool_versions, manifest_sha256, error FROM capture.captures WHERE item_id = %s"
            " ORDER BY created_at DESC", (item_id,))).fetchall()
        arts = await (await conn.execute(
            "SELECT a.id, a.capture_id, a.witness, a.kind, a.role, a.label, a.sha256, a.bytes, a.mime, a.source_url,"
            " a.width, a.height, a.duration_s FROM capture.artifacts a JOIN capture.captures c ON c.id = a.capture_id"
            " WHERE c.item_id = %s ORDER BY a.role DESC, a.kind, a.label", (item_id,))).fetchall()
    by_cap: dict[str, list] = {}
    for a in arts:
        a = {**a, "id": str(a["id"]), "capture_id": str(a["capture_id"]),
             "url": f"/v1/artifacts/{a['id']}"}
        by_cap.setdefault(a["capture_id"], []).append(a)
    item["captures"] = [{**c, "id": str(c["id"]), "artifacts": by_cap.get(str(c["id"]), [])} for c in caps]
    return item


@app.patch("/v1/items/{item_id}")
async def patch_item(item_id: str, body: ItemPatch, request: Request, p: Principal = Depends(current_principal)):
    changes = body.model_dump(exclude_unset=True)
    async with request.app.state.pool.connection() as conn:
        r = await _get_item(conn, item_id, p)
        if str(r["submitted_by"]) != p.contributor_id and not p.at_least("editor"):
            raise HTTPException(403, "only the submitter or an editor can edit this item")
        if changes:
            cols = ", ".join(f"{k} = %s" for k in changes)
            await conn.execute(f"UPDATE capture.items SET {cols}, updated_at = now() WHERE id = %s",
                               (*changes.values(), item_id))
        return _item_json(await _get_item(conn, item_id, p))


@app.post("/v1/items/{item_id}/recapture", status_code=202)
async def recapture(item_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        r = await _get_item(conn, item_id, p)
        if r["capture_state"] in ("queued", "running"):
            raise HTTPException(409, "a capture of this item is already in progress")
        cap_id = await _new_capture(conn, item_id, p)
    return {"capture_id": cap_id}


@app.get("/v1/artifacts/{artifact_id}")
async def get_artifact(artifact_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        a = await (await conn.execute(
            "SELECT a.*, i.id AS item_id FROM capture.artifacts a JOIN capture.captures c ON c.id = a.capture_id"
            " JOIN capture.items i ON i.id = c.item_id WHERE a.id = %s", (artifact_id,))).fetchone()
        if not a:
            raise HTTPException(404, "artifact not found")
        await _get_item(conn, a["item_id"], p)  # permission check
    if a["kind"] == "link":
        return RedirectResponse(a["source_url"])
    f = get_storage().open(a["storage_key"])
    headers = {"X-Content-SHA256": a["sha256"], "Cache-Control": "private, max-age=86400",
               # Captured HTML is hostile content: never let it run in our origin.
               "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff"}
    if a["bytes"]:
        headers["Content-Length"] = str(a["bytes"])
    return StreamingResponse(iter_chunks(f), media_type=(a["mime"] or "application/octet-stream"), headers=headers)

"""Community intake (docs/integration-design.md §5).

Public sites ("sources": the MemoryLane community map, Hồ sơ Nhân quyền) keep their own anonymous forms and
forward each submission here. Their key can only create submissions and read receipts: it can't read anything
else back.

  Intake API (/intake/v1, called by a source's backend, every request signed):
    POST /intake/v1/submissions                       a submission; idempotent on (source, external_id)
    PUT  /intake/v1/submissions/{id}/files/{n}        one attachment, raw bytes
    GET  /intake/v1/receipts/{receipt_sha256}         coarse status for the submitter
    GET  /intake/v1/contact-key                       public key to seal contact details to

  Signing: X-ML-Source: <slug>, X-ML-Timestamp: <unix seconds>, X-ML-Nonce: <16-64 random [A-Za-z0-9_-]>,
           X-ML-Signature: hex HMAC-SHA256(key, "<timestamp>\\n<nonce>\\n<METHOD>\\n<path>\\n<hex sha256 of body>").
  Requests older than 5 minutes, and any nonce seen before, are refused (a retry signs again with a new nonce).

  Triage (/v1/intake, the "Hộp tiếp nhận" UI): project viewers see the submissions routed to their project;
  editors attach one to an incident, create an incident from it, or reject it; managers reroute, reopen, and
  can reveal a sealed contact (logged).

Links in a submission are captured immediately, as ordinary items saved by the source's contributor, because
posts get deleted fast. They stay private (reviewers, and members of the project the submission is routed to)
until someone files them under an incident.
"""

import base64
import hashlib
import hmac
import logging
import os
import re
import secrets
import tempfile
import time
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, ValidationError, field_validator

from .access import at_least, project_role, require_project
from .auth import Principal, current_principal, require
from .config import settings
from .derive import SNIFF_LIMIT, looks_like_text, sniff
from .inbox_core import ITEM_SELECT, add_update, item_json_for, link_item, save_link
from .serve import stored_response
from .signing import intake_file_url, verify_intake_file
from .storage import get_storage, key_for, sha256_file

log = logging.getLogger("memlane.intake")
spoke = APIRouter(prefix="/intake/v1", tags=["intake (public sites)"])
router = APIRouter(prefix="/v1")

MAX_SKEW_S = 300
MAX_LINKS = 20
GROUP_LABELS = {"violation": "Vi phạm", "proceeding": "Tố tụng",
                "platform_restriction": "Hạn chế mạng xã hội", "movement": "Phong trào xã hội"}
GROUP_ATTRIBUTE = "nhóm hồ sơ"     # decision 6: one project, the group is this select attribute
_URL_RE = re.compile(r"https?://[^\s<>\"'()\[\]{}]+", re.I)


# ---- keys and request signing ----------------------------------------------------------------
def derive_key(slug: str, version: int) -> str:
    """A source's key. Derived, so the database holds no secret; bump key_version to revoke."""
    if not settings.intake_key_secret:
        raise HTTPException(503, "intake is not configured (INTAKE_KEY_SECRET)")
    return hmac.new(settings.intake_key_secret.encode(), f"memlane-intake:{slug}:{version}".encode(),
                    hashlib.sha256).hexdigest()


def signature(key: str, ts: str, nonce: str, method: str, path: str, body_sha256: str) -> str:
    return hmac.new(key.encode(), f"{ts}\n{nonce}\n{method.upper()}\n{path}\n{body_sha256}".encode(),
                    hashlib.sha256).hexdigest()


async def _verify(request: Request, body_sha256: str) -> dict:
    slug = request.headers.get("x-ml-source", "")
    ts = request.headers.get("x-ml-timestamp", "")
    sig = request.headers.get("x-ml-signature", "")
    nonce = request.headers.get("x-ml-nonce", "")
    if not (slug and ts.isdigit() and re.fullmatch(r"[0-9a-f]{64}", sig) and re.fullmatch(r"[A-Za-z0-9_-]{16,64}", nonce)):
        raise HTTPException(401, "missing or malformed signature headers")
    if abs(time.time() - int(ts)) > MAX_SKEW_S:
        raise HTTPException(401, "timestamp too old or in the future (check the clock)")
    async with request.app.state.pool.connection() as conn:
        src = await (await conn.execute("SELECT * FROM capture.sources WHERE slug = %s AND disabled_at IS NULL",
                                        (slug,))).fetchone()
        expected = signature(derive_key(slug, src["key_version"]) if src else secrets.token_hex(32), ts, nonce,
                             request.method, request.url.path, body_sha256)
        if not src or not hmac.compare_digest(expected, sig):
            raise HTTPException(401, "bad signature")
        cur = await conn.execute("INSERT INTO capture.intake_nonces (sig_sha256) VALUES (%s) ON CONFLICT DO NOTHING",
                                 (hashlib.sha256(f"{slug}:{nonce}".encode()).hexdigest(),))
        if not cur.rowcount:
            raise HTTPException(409, "this request was already received (replay)")
        if secrets.randbelow(50) == 0:
            await conn.execute("DELETE FROM capture.intake_nonces WHERE seen_at < now() - interval '15 minutes'")
    return src


def _source_principal(src: dict) -> Principal:
    return Principal(str(src["contributor_id"]), f"Nguồn: {src['name']}", "contributor", "", f"intake:{src['slug']}")


# ---- submission models ---------------------------------------------------------------------------
Precision = Literal["exact", "street", "ward", "province", "none"]


class Location(BaseModel):
    lat: float | None = Field(None, ge=-90, le=90)
    lng: float | None = Field(None, ge=-180, le=180)
    label: str | None = Field(None, max_length=200)
    ward: str | None = Field(None, max_length=120)
    city: str | None = Field(None, max_length=120)
    province: str | None = Field(None, max_length=120)
    # The submitter's wish: show no finer than this (a ceiling for the public version, §12.3).
    precision_wish: Precision | None = None
    allow_exact: bool = False


class DateIn(BaseModel):
    year: int | None = Field(None, ge=1900, le=2100)
    month: int | None = Field(None, ge=1, le=12)
    day: int | None = Field(None, ge=1, le=31)
    label: str | None = Field(None, max_length=120)


class MemoryPayload(BaseModel):
    text: str = Field(..., min_length=1, max_length=8000)
    text_en: str | None = Field(None, max_length=8000)
    category: Literal["personal", "news", "community", "event"] = "personal"
    date: DateIn | None = None
    location: Location | None = None
    case_ref: str | None = Field(None, max_length=100)
    pseudonym: str | None = Field(None, max_length=80)


class CaseReportPayload(BaseModel):
    group: Literal["violation", "proceeding", "platform_restriction", "movement"]
    title: str = Field(..., min_length=1, max_length=300)
    description: str = Field(..., min_length=1, max_length=10000)
    timeline: str | None = Field(None, max_length=10000)
    date: DateIn | None = None
    location: Location | None = None
    fields: dict[str, str] = Field(default_factory=dict, max_length=30)   # group-specific: court, stage, platform…
    pseudonym: str | None = Field(None, max_length=80)

    @field_validator("fields")
    @classmethod
    def _short(cls, v):
        if any(len(k) > 60 or len(x) > 2000 for k, x in v.items()):
            raise ValueError("fields: keys up to 60 and values up to 2000 characters")
        return v


class DocumentPayload(BaseModel):
    doc_type: str | None = Field(None, max_length=80)
    title: str = Field(..., min_length=1, max_length=300)
    context: str | None = Field(None, max_length=10000)
    case_ref: str | None = Field(None, max_length=100)
    alt_link: str | None = Field(None, max_length=2000)
    pseudonym: str | None = Field(None, max_length=80)


class LinkPayload(BaseModel):
    url: str = Field(..., max_length=4000)
    note: str | None = Field(None, max_length=5000)


PAYLOADS = {"memory": MemoryPayload, "case_report": CaseReportPayload, "document": DocumentPayload,
            "link": LinkPayload}


class FileDecl(BaseModel):
    n: int = Field(..., ge=1, le=10)
    mime: str = Field(..., max_length=100)
    bytes: int = Field(..., ge=1)


class Submission(BaseModel):
    external_id: str = Field(..., pattern=r"^[A-Za-z0-9_.:\-]{1,120}$")
    kind: Literal["memory", "case_report", "document", "link"]
    submitted_at: datetime | None = None
    lang: str | None = Field(None, max_length=8)
    payload: dict
    links: list[str] = Field(default_factory=list, max_length=MAX_LINKS)
    files: list[FileDecl] = Field(default_factory=list, max_length=10)
    contact: dict | None = None          # {"sealed": base64 sealed box}
    consents: dict[str, bool] = Field(default_factory=dict, max_length=10)
    receipt_sha256: str | None = Field(None, pattern=r"^[0-9a-f]{64}$")
    legacy_public: bool = False


def found_links(sub: Submission, payload: BaseModel) -> list[str]:
    """Every http(s) link: the declared ones plus any in the text fields, deduplicated, at most MAX_LINKS."""
    texts = [v for v in payload.model_dump().values() if isinstance(v, str)]
    if isinstance(payload, CaseReportPayload):
        texts += list(payload.fields.values())
    out = []
    for u in [*sub.links, *[m.rstrip(".,;:!?") for t in texts for m in _URL_RE.findall(t)]]:
        u = u.strip()
        if u.lower().startswith(("http://", "https://")) and len(u) <= 4000 and u not in out:
            out.append(u)
    return out[:MAX_LINKS]


# ---- Intake API (sources) --------------------------------------------------------------------------
@spoke.post("/submissions")
async def submit(request: Request):
    body = await request.body()
    if len(body) > 256_000:
        raise HTTPException(413, "submission too large (files go in separate uploads)")
    src = await _verify(request, hashlib.sha256(body).hexdigest())
    try:
        sub = Submission.model_validate_json(body)
        payload = PAYLOADS[sub.kind].model_validate(sub.payload)
    except ValidationError as e:
        raise HTTPException(422, e.errors(include_url=False, include_context=False)) from None
    if len({f.n for f in sub.files}) != len(sub.files):
        raise HTTPException(422, "file numbers must be unique")
    sealed = (sub.contact or {}).get("sealed")
    if sealed is not None and (not isinstance(sealed, str) or len(sealed) > 4000):
        raise HTTPException(422, "contact.sealed must be a base64 string")

    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(hashtext(%s))", (f"intake:{src['id']}:{sub.external_id}",))
            dup = await (await conn.execute("SELECT id, received_at FROM capture.intake WHERE source_id = %s"
                                            " AND external_id = %s", (src["id"], sub.external_id))).fetchone()
            if dup:
                return {"intake_id": str(dup["id"]), "duplicate": True, "received_at": dup["received_at"]}
            recent = await (await conn.execute(
                "SELECT count(*) AS n FROM capture.intake WHERE source_id = %s AND received_at > now() - interval '1 hour'",
                (src["id"],))).fetchone()
            if recent["n"] >= src["rate_per_hour"]:
                raise HTTPException(429, "this source sent too many submissions this hour")
            links = found_links(sub, payload)
            project_id = (src["routing"] or {}).get(sub.kind)
            row = await (await conn.execute(
                "INSERT INTO capture.intake (source_id, external_id, kind, lang, submitted_at, payload, links,"
                " files_declared, contact_sealed, consents, receipt_sha256, legacy_public, project_id)"
                " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) RETURNING id, received_at",
                (src["id"], sub.external_id, sub.kind, sub.lang, sub.submitted_at,
                 Jsonb(payload.model_dump(exclude_none=True)), links, Jsonb([f.model_dump() for f in sub.files]),
                 sealed, Jsonb(sub.consents), sub.receipt_sha256, sub.legacy_public, project_id))).fetchone()
            for f in sub.files:
                await conn.execute("INSERT INTO capture.intake_files (intake_id, n, mime, bytes) VALUES (%s,%s,%s,%s)",
                                   (row["id"], f.n, f.mime, f.bytes))
            # Capture the links now: posts get deleted fast. They stay private until filed (module docstring).
            sp = _source_principal(src)
            for u in links:
                try:
                    _, res = await save_link(conn, sp, url=u, text=None, client="intake", rate_limit=False)
                except HTTPException:
                    continue    # not a usable link; it is still listed in the submission
                await conn.execute("INSERT INTO capture.intake_items (intake_id, item_id) VALUES (%s,%s)"
                                   " ON CONFLICT DO NOTHING", (row["id"], res["item"]["id"]))
    log.info("intake %s from %s: %s, %d link(s), %d file(s)", row["id"], src["slug"], sub.kind, len(links),
             len(sub.files))
    return {"intake_id": str(row["id"]), "duplicate": False, "received_at": row["received_at"],
            "links": len(links), "files_expected": [f.n for f in sub.files]}


@spoke.put("/submissions/{intake_id}/files/{n}")
async def upload_file(intake_id: str, n: int, request: Request):
    cap = max(settings.intake_max_video_mb, settings.intake_max_file_mb) * 1024 * 1024
    with tempfile.TemporaryDirectory(prefix="memlane-intake-") as tmp:
        path = os.path.join(tmp, "upload")
        h, size, head = hashlib.sha256(), 0, b""
        with open(path, "wb") as f:
            async for chunk in request.stream():
                size += len(chunk)
                if size > cap:
                    raise HTTPException(413, "file too large")
                if len(head) < SNIFF_LIMIT:
                    head += chunk[:SNIFF_LIMIT - len(head)]
                h.update(chunk)
                f.write(chunk)
        src = await _verify(request, h.hexdigest())
        async with request.app.state.pool.connection() as conn:
            async with conn.transaction():
                rec = await (await conn.execute(
                    "SELECT f.* FROM capture.intake_files f JOIN capture.intake k ON k.id = f.intake_id"
                    " WHERE f.intake_id = %s AND f.n = %s AND k.source_id = %s FOR UPDATE OF f",
                    (intake_id, n, src["id"]))).fetchone()
                if not rec:
                    raise HTTPException(404, "no such file announced in that submission")
                if rec["state"] == "stored":
                    return {"stored": True, "duplicate": True, "sha256": rec["sha256"]}
                error = None
                found = sniff(head)
                if not found and (rec["mime"] or "").startswith("text/plain") and looks_like_text(path):
                    found = ("text", "text/plain")
                if not found:
                    error = "not an accepted file type (JPG, PNG, WEBP, GIF, MP4, WEBM, PDF, TXT)"
                elif size != rec["bytes"]:
                    error = f"size {size} differs from the {rec['bytes']} bytes announced"
                elif size > (settings.intake_max_video_mb if found[0] == "video" else settings.intake_max_file_mb) * 1048576:
                    error = "file too large for its type"
                if error:
                    await conn.execute("UPDATE capture.intake_files SET state = 'rejected', error = %s,"
                                       " received_at = now() WHERE id = %s", (error, rec["id"]))
                    raise HTTPException(422, error)
                kind, mime = found
                sha, _ = sha256_file(path)
                ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
                       "video/mp4": ".mp4", "video/webm": ".webm", "application/pdf": ".pdf",
                       "text/plain": ".txt"}[mime]
                key = key_for(sha, ext)
                # Stored exactly as received (EXIF included): it is the evidence. Public copies are cleaned (derive.py).
                get_storage().put(path, key, mime)
                await conn.execute("UPDATE capture.intake_files SET state = 'stored', kind = %s, mime = %s, sha256 = %s,"
                                   " storage_key = %s, received_at = now(), error = NULL WHERE id = %s",
                                   (kind, mime, sha, key, rec["id"]))
    return {"stored": True, "duplicate": False, "sha256": sha, "kind": kind}


async def receipt_status(conn, k: dict) -> str:
    """What a submitter may know: received / in_review / published / not_published. Nothing else."""
    if k["state"] == "rejected":
        return "not_published"
    pub = await (await conn.execute(
        "SELECT 1 FROM capture.publications WHERE state = 'published' AND (intake_id = %s OR (incident_id = %s))",
        (k["id"], k["incident_id"]))).fetchone()
    if pub:
        return "published"
    return "received" if k["state"] == "new" else "in_review"


@spoke.get("/receipts/{receipt_sha256}")
async def receipt(receipt_sha256: str, request: Request):
    src = await _verify(request, hashlib.sha256(b"").hexdigest())
    async with request.app.state.pool.connection() as conn:
        k = await (await conn.execute("SELECT id, state, incident_id FROM capture.intake WHERE receipt_sha256 = %s"
                                      " AND source_id = %s", (receipt_sha256, src["id"]))).fetchone()
        if not k:
            raise HTTPException(404, "unknown receipt")
        return {"status": await receipt_status(conn, k)}


def _contact_box():
    from nacl.public import PrivateKey
    if not settings.contact_secret_key:
        raise HTTPException(503, "sealed contacts are not configured (CONTACT_SECRET_KEY)")
    return PrivateKey(base64.b64decode(settings.contact_secret_key))


@spoke.get("/contact-key")
async def contact_key(request: Request):
    await _verify(request, hashlib.sha256(b"").hexdigest())
    return {"public_key": base64.b64encode(bytes(_contact_box().public_key)).decode(),
            "scheme": "libsodium crypto_box_seal (X25519, XSalsa20-Poly1305), base64"}


# ---- triage (Hộp tiếp nhận) -----------------------------------------------------------------------
class AttachIn(BaseModel):
    incident_id: str


class CreateIn(BaseModel):
    description: str | None = Field(None, min_length=1, max_length=1000)


class RejectIn(BaseModel):
    reason: str | None = Field(None, max_length=2000)


class RouteIn(BaseModel):
    project_id: str


INTAKE_SELECT = """
SELECT k.*, s.slug AS source_slug, s.name AS source_name, pr.code, pr.name AS project_name, pr.color,
       inc.number AS incident_number, ipr.code AS incident_code, rv.display_name AS reviewed_by_name,
       (SELECT count(*) FROM capture.intake_items ii WHERE ii.intake_id = k.id) AS item_count,
       (SELECT count(*) FROM capture.intake_files f WHERE f.intake_id = k.id AND f.state = 'stored') AS file_count
  FROM capture.intake k
  JOIN capture.sources s ON s.id = k.source_id
  LEFT JOIN capture.projects pr ON pr.id = k.project_id
  LEFT JOIN capture.incidents inc ON inc.id = k.incident_id
  LEFT JOIN capture.projects ipr ON ipr.id = inc.project_id
  LEFT JOIN capture.contributors rv ON rv.id = k.reviewed_by
"""


def _summary(k: dict) -> str:
    p = k["payload"] or {}
    return (p.get("title") or p.get("text") or p.get("note") or p.get("url") or "")[:300]


def _intake_json(k: dict, role: str | None) -> dict:
    return {
        "id": str(k["id"]), "kind": k["kind"], "state": k["state"], "lang": k["lang"],
        "source": {"slug": k["source_slug"], "name": k["source_name"]},
        "summary": _summary(k), "submitted_at": k["submitted_at"], "received_at": k["received_at"],
        "project": None if not k["project_id"] else {"id": str(k["project_id"]), "code": k["code"],
                                                     "name": k["project_name"], "color": k["color"]},
        "incident": None if not k["incident_id"] else {"id": str(k["incident_id"]),
                                                       "slug": f"{k['incident_code']}-{k['incident_number']}"},
        "legacy_public": k["legacy_public"], "has_contact": bool(k["contact_sealed"]),
        "item_count": k["item_count"], "file_count": k["file_count"],
        "reviewed_by": k["reviewed_by_name"], "reviewed_at": k["reviewed_at"], "reason": k["reason"],
        "my_role": role,
    }


async def _get_intake(conn, intake_id: str, p: Principal, minimum: str = "viewer") -> tuple[dict, str]:
    k = await (await conn.execute(INTAKE_SELECT + " WHERE k.id = %s", (intake_id,))).fetchone()
    if not k:
        raise HTTPException(404, "submission not found")
    if not k["project_id"]:
        if p.role != "admin":
            raise HTTPException(404, "submission not found")
        return k, "owner"
    role = await project_role(conn, p, k["project_id"])
    if role is None or role == "data_only_viewer":     # submissions may identify people: viewers and up only
        raise HTTPException(404, "submission not found")
    if not at_least(role, minimum):
        raise HTTPException(403, f"requires the {minimum} role in this project")
    return k, role


async def intake_files(conn, intake_id) -> list[dict]:
    rows = await (await conn.execute("SELECT * FROM capture.intake_files WHERE intake_id = %s ORDER BY n",
                                     (intake_id,))).fetchall()
    return [{"id": str(f["id"]), "n": f["n"], "kind": f["kind"], "mime": f["mime"], "bytes": f["bytes"],
             "sha256": f["sha256"], "state": f["state"], "error": f["error"],
             "url": intake_file_url(f["id"]) if f["state"] == "stored" else None} for f in rows]


@router.get("/intake")
async def list_intake(request: Request, p: Principal = Depends(current_principal), project_id: str | None = None,
                      state: str | None = "new", limit: int = 100, offset: int = 0):
    where, args = [], []
    if p.role != "admin":
        where.append("EXISTS (SELECT 1 FROM capture.project_members m WHERE m.project_id = k.project_id"
                     " AND m.contributor_id = %s AND m.role <> 'data_only_viewer')")
        args.append(p.contributor_id)
    if project_id == "none":
        where.append("k.project_id IS NULL")
    elif project_id:
        where.append("k.project_id = %s")
        args.append(project_id)
    if state and state != "all":
        where.append("k.state = %s")
        args.append(state)
    sql = INTAKE_SELECT + (" WHERE " + " AND ".join(where) if where else "") + \
        " ORDER BY k.received_at DESC LIMIT %s OFFSET %s"
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(sql, (*args, min(limit, 500), offset))).fetchall()
        roles = {pid: await project_role(conn, p, pid) for pid in {r["project_id"] for r in rows if r["project_id"]}}
        counts = await (await conn.execute(
            "SELECT k.project_id, count(*) AS n FROM capture.intake k WHERE k.state = 'new'"
            + (" AND " + where[0] if p.role != "admin" else "") + " GROUP BY k.project_id",
            tuple(args[:1]) if p.role != "admin" else ())).fetchall()
    return {"intake": [_intake_json(r, roles.get(r["project_id"]) or ("owner" if p.role == "admin" else None))
                       for r in rows],
            "new_by_project": {str(c["project_id"]) if c["project_id"] else "none": c["n"] for c in counts}}


@router.get("/intake/{intake_id}")
async def get_intake(intake_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        k, role = await _get_intake(conn, intake_id, p)
        items = await (await conn.execute(
            ITEM_SELECT + " JOIN capture.intake_items link ON link.item_id = i.id WHERE link.intake_id = %s"
            " ORDER BY i.created_at", (intake_id,))).fetchall()
        pub = await (await conn.execute("SELECT id, state, public_id FROM capture.publications WHERE intake_id = %s",
                                        (intake_id,))).fetchone()
        inc_pub = None if not k["incident_id"] else await (await conn.execute(
            "SELECT id, state, public_id, dirty FROM capture.publications WHERE incident_id = %s", (k["incident_id"],))).fetchone()
        out = _intake_json(k, role)
        out.update(payload=k["payload"], links=k["links"], consents=k["consents"],
                   files=await intake_files(conn, intake_id),
                   items=[await item_json_for(conn, p, i) for i in items],
                   publication=None if not pub else {"id": str(pub["id"]), "state": pub["state"],
                                                     "public_id": pub["public_id"]},
                   incident_publication=None if not inc_pub else {"id": str(inc_pub["id"]), "state": inc_pub["state"],
                                                                  "public_id": inc_pub["public_id"], "dirty": inc_pub["dirty"]})
    return out


async def _review(conn, k: dict, p: Principal, state: str, incident_id=None, reason=None) -> None:
    await conn.execute("UPDATE capture.intake SET state = %s, incident_id = COALESCE(%s, incident_id), reviewed_by = %s,"
                       " reviewed_at = now(), reason = %s WHERE id = %s",
                       (state, incident_id, p.contributor_id, reason, k["id"]))


async def _attach(conn, k: dict, p: Principal, incident_id: str, state: str) -> None:
    items = await (await conn.execute("SELECT item_id FROM capture.intake_items WHERE intake_id = %s",
                                      (k["id"],))).fetchall()
    for it in items:
        await link_item(conn, p, it["item_id"], incident_id)   # checks: editor of the incident's project
    if not items:
        from .inbox_core import _writable_incident
        await _writable_incident(conn, p, incident_id)
    await add_update(conn, incident_id=incident_id, kind="intake", p=p,
                     new={"intake_id": str(k["id"]), "source": k["source_slug"], "kind": k["kind"]},
                     body=f"{k['source_name']}: {_summary(k)}"[:1000])
    await conn.execute("UPDATE capture.incidents SET updated_at = now() WHERE id = %s", (incident_id,))
    await _review(conn, k, p, state, incident_id=incident_id)
    # If the incident already has a public version, the submission joins it as a community note at once, and a
    # published version is marked "unpublished changes" until someone approves the new version.
    from .publish import refresh_for_incidents
    await refresh_for_incidents(conn, [incident_id])


@router.post("/intake/{intake_id}/attach")
async def attach(intake_id: str, body: AttachIn, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            k, _ = await _get_intake(conn, intake_id, p, "editor")
            if k["state"] != "new":
                raise HTTPException(409, "this submission was already reviewed")
            await _attach(conn, k, p, body.incident_id, "attached")
    return await get_intake(intake_id, request, p)


def incident_from_submission(k: dict, attributes: list[dict]) -> dict:
    """Fields for a new incident, prefilled from a submission (the reviewer can edit them afterwards)."""
    pl = k["payload"] or {}
    if k["kind"] == "case_report":
        desc = pl.get("title", "") + ("\n\n" + pl["description"] if pl.get("description") else "")
    elif k["kind"] == "document":
        desc = pl.get("title", "") + ("\n\n" + pl["context"] if pl.get("context") else "")
    elif k["kind"] == "memory":
        desc = pl.get("text", "")
    else:
        desc = pl.get("note") or pl.get("url") or "Liên kết từ cộng đồng"
    out: dict = {"description": desc.strip()[:1000] or "Báo cáo từ cộng đồng"}
    d = pl.get("date") or {}
    if d.get("year") and d.get("month") and d.get("day"):
        try:
            out["event_date"] = f"{d['year']:04d}-{d['month']:02d}-{d['day']:02d}"
            datetime.fromisoformat(out["event_date"])
        except ValueError:
            out.pop("event_date")
    loc = pl.get("location") or {}
    place = ", ".join(x for x in (loc.get("label"), loc.get("ward"), loc.get("city") or loc.get("province")) if x)
    if place:
        out["place"] = place[:300]
    if loc.get("lat") is not None and loc.get("lng") is not None:
        out.update(lat=loc["lat"], lng=loc["lng"], geo_precision="exact")
    if k["kind"] == "case_report" and pl.get("group") in GROUP_LABELS:
        attr = next((a for a in attributes if a["name"].strip().lower() == GROUP_ATTRIBUTE and a["type"] == "select"),
                    None)
        label = GROUP_LABELS[pl["group"]]
        if attr and (not attr["options"] or label in attr["options"]):
            out["custom"] = {attr["id"]: label}
    return out


@router.post("/intake/{intake_id}/create")
async def create_from(intake_id: str, body: CreateIn, request: Request, p: Principal = Depends(current_principal)):
    from .workspace import IncidentIn, _create_incident   # workspace imports inbox_core, like this module
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            k, role = await _get_intake(conn, intake_id, p, "editor")
            if k["state"] != "new":
                raise HTTPException(409, "this submission was already reviewed")
            if not k["project_id"]:
                raise HTTPException(409, "route the submission to a project first")
            proj = await (await conn.execute("SELECT attributes FROM capture.projects WHERE id = %s",
                                             (k["project_id"],))).fetchone()
            fields = incident_from_submission(k, proj["attributes"])
            if body.description:
                fields["description"] = body.description
            incident_id, _ = await _create_incident(
                conn, p, IncidentIn(project_id=str(k["project_id"]), **fields), role,
                created_note=f"Từ hộp tiếp nhận ({k['source_name']})")
            await _attach(conn, k, p, incident_id, "created")
    out = await get_intake(intake_id, request, p)
    out["created_incident_id"] = incident_id
    return out


@router.post("/intake/{intake_id}/reject")
async def reject(intake_id: str, body: RejectIn, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            k, _ = await _get_intake(conn, intake_id, p, "editor")
            if k["state"] != "new":
                raise HTTPException(409, "this submission was already reviewed")
            await _review(conn, k, p, "rejected", reason=(body.reason or "").strip() or None)
    return await get_intake(intake_id, request, p)


@router.post("/intake/{intake_id}/reopen")
async def reopen(intake_id: str, request: Request, p: Principal = Depends(current_principal)):
    async with request.app.state.pool.connection() as conn:
        k, _ = await _get_intake(conn, intake_id, p, "manager")
        await conn.execute("UPDATE capture.intake SET state = 'new', reviewed_by = NULL, reviewed_at = NULL, reason = NULL"
                           " WHERE id = %s AND state IN ('rejected', 'attached', 'created')", (k["id"],))
    return await get_intake(intake_id, request, p)


@router.post("/intake/{intake_id}/route")
async def route(intake_id: str, body: RouteIn, request: Request, p: Principal = Depends(current_principal)):
    """Move a submission to another project: managers of its project (or admins), who are editors there."""
    async with request.app.state.pool.connection() as conn:
        k, _ = await _get_intake(conn, intake_id, p, "manager")
        await require_project(conn, p, body.project_id, "editor")
        await conn.execute("UPDATE capture.intake SET project_id = %s WHERE id = %s", (body.project_id, k["id"]))
    return await get_intake(intake_id, request, p)


@router.post("/intake/{intake_id}/contact")
async def reveal_contact(intake_id: str, request: Request, p: Principal = Depends(current_principal)):
    """Open the sealed contact: project managers and owners only. Every reveal is logged."""
    from nacl.exceptions import CryptoError
    from nacl.public import SealedBox
    async with request.app.state.pool.connection() as conn:
        k, _ = await _get_intake(conn, intake_id, p, "manager")
        if not k["contact_sealed"]:
            raise HTTPException(404, "no contact was given")
        try:
            plain = SealedBox(_contact_box()).decrypt(base64.b64decode(k["contact_sealed"])).decode("utf-8")
        except (CryptoError, ValueError, UnicodeDecodeError):
            raise HTTPException(422, "the contact can't be opened with this server's key") from None
        await conn.execute("INSERT INTO capture.contact_reveals (intake_id, contributor_id) VALUES (%s, %s)",
                           (k["id"], p.contributor_id))
        n = (await (await conn.execute("SELECT count(*) AS n FROM capture.contact_reveals WHERE intake_id = %s",
                                       (k["id"],))).fetchone())["n"]
    return {"contact": plain, "reveals": n}


@router.get("/intake-files/{file_id}")
async def get_intake_file(file_id: str, request: Request, exp: str | None = None, sig: str | None = None):
    async with request.app.state.pool.connection() as conn:
        f = await (await conn.execute("SELECT * FROM capture.intake_files WHERE id = %s AND state = 'stored'",
                                      (file_id,))).fetchone()
        if not f:
            raise HTTPException(404, "file not found")
        if not verify_intake_file(file_id, exp, sig):
            await _get_intake(conn, str(f["intake_id"]), await current_principal(request))
    return stored_response(request, storage_key=f["storage_key"], size=f["bytes"], mime=f["mime"], sha256=f["sha256"])


# ---- sources (admin) ------------------------------------------------------------------------------------
class SourceIn(BaseModel):
    slug: str | None = Field(None, pattern=r"^[a-z0-9][a-z0-9-]{1,40}$")
    name: str | None = Field(None, min_length=1, max_length=120)
    routing: dict[Literal["memory", "case_report", "document", "link"], str | None] | None = None
    rate_per_hour: int | None = Field(None, ge=1, le=100000)
    disabled: bool | None = None


def _source_json(r: dict) -> dict:
    return {"id": str(r["id"]), "slug": r["slug"], "name": r["name"], "routing": r["routing"],
            "rate_per_hour": r["rate_per_hour"], "key_version": r["key_version"], "created_at": r["created_at"],
            "disabled": r["disabled_at"] is not None, "submissions": r.get("submissions"),
            "last_received_at": r.get("last_received_at")}


async def _check_routing(conn, routing: dict) -> dict:
    out = {}
    for kind, pid in routing.items():
        if pid:
            if not await (await conn.execute("SELECT 1 FROM capture.projects WHERE id = %s", (pid,))).fetchone():
                raise HTTPException(422, f"routing.{kind}: no such project")
            out[kind] = pid
    return out


@router.get("/admin/sources")
async def list_sources(request: Request, p: Principal = Depends(require("admin"))):
    async with request.app.state.pool.connection() as conn:
        rows = await (await conn.execute(
            "SELECT s.*, count(k.id) AS submissions, max(k.received_at) AS last_received_at FROM capture.sources s"
            " LEFT JOIN capture.intake k ON k.source_id = s.id GROUP BY s.id ORDER BY s.name")).fetchall()
    return {"sources": [_source_json(r) for r in rows], "configured": bool(settings.intake_key_secret),
            "contact_key_configured": bool(settings.contact_secret_key)}


@router.post("/admin/sources", status_code=201)
async def create_source(body: SourceIn, request: Request, p: Principal = Depends(require("admin"))):
    if not body.slug or not body.name:
        raise HTTPException(422, "slug and name are required")
    async with request.app.state.pool.connection() as conn:
        async with conn.transaction():
            if await (await conn.execute("SELECT 1 FROM capture.sources WHERE slug = %s", (body.slug,))).fetchone():
                raise HTTPException(409, "slug already used")
            routing = await _check_routing(conn, body.routing or {})
            c = await (await conn.execute("INSERT INTO capture.contributors (display_name, role) VALUES (%s, 'contributor')"
                                          " RETURNING id", (f"Nguồn: {body.name}",))).fetchone()
            r = await (await conn.execute(
                "INSERT INTO capture.sources (slug, name, routing, rate_per_hour, contributor_id, created_by)"
                " VALUES (%s,%s,%s,%s,%s,%s) RETURNING *",
                (body.slug, body.name, Jsonb(routing), body.rate_per_hour or 300, c["id"], p.contributor_id))).fetchone()
    # The key is shown once; the source's backend keeps it (never in a browser).
    return {**_source_json(r), "key": derive_key(r["slug"], r["key_version"])}


@router.patch("/admin/sources/{source_id}")
async def update_source(source_id: str, body: SourceIn, request: Request, p: Principal = Depends(require("admin"))):
    ch = body.model_dump(exclude_unset=True)
    ch.pop("slug", None)    # part of every signed request; never changes
    async with request.app.state.pool.connection() as conn:
        sets, args = [], []
        if "name" in ch:
            sets.append("name = %s")
            args.append(ch["name"])
        if "routing" in ch:
            sets.append("routing = %s")
            args.append(Jsonb(await _check_routing(conn, ch["routing"] or {})))
        if "rate_per_hour" in ch:
            sets.append("rate_per_hour = %s")
            args.append(ch["rate_per_hour"])
        if "disabled" in ch:
            sets.append("disabled_at = " + ("now()" if ch["disabled"] else "NULL"))
        if sets:
            await conn.execute(f"UPDATE capture.sources SET {', '.join(sets)} WHERE id = %s", (*args, source_id))
        r = await (await conn.execute("SELECT * FROM capture.sources WHERE id = %s", (source_id,))).fetchone()
    if not r:
        raise HTTPException(404, "source not found")
    return _source_json(r)


@router.post("/admin/sources/{source_id}/rotate")
async def rotate_source_key(source_id: str, request: Request, p: Principal = Depends(require("admin"))):
    """A new key; the old one stops working at once."""
    async with request.app.state.pool.connection() as conn:
        r = await (await conn.execute("UPDATE capture.sources SET key_version = key_version + 1 WHERE id = %s"
                                      " RETURNING *", (source_id,))).fetchone()
    if not r:
        raise HTTPException(404, "source not found")
    return {**_source_json(r), "key": derive_key(r["slug"], r["key_version"])}

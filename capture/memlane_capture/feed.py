"""The publication feed (integration-design §6.2): a static, signed tree the public sites and mirrors read.

    keys.json            root public key, the root's delegation of the online key, revocations
    index.json           every live record {type, public_id, version, updated_at, path, sha256} + tombstones
    index.json.sig       {"online_public", "signature"}: Ed25519 over the exact bytes of index.json
    records/<id>.<hash>.json  one public record, content-addressed (its sha256 is in the index, so the signature covers it)
    files/<sha256>.<ext> cleaned media, content-addressed

Rebuilt in full by the worker whenever a publication is approved or withdrawn (feed_state.dirty). Files and
records no live record uses are deleted, so a withdrawal removes the media too. Readers verify: root (pinned)
→ delegation → index signature → record and file hashes. See spokes/hub-client.js for the reference verifier.
"""

import asyncio
import hashlib
import json
import logging
import os
import pathlib
from datetime import datetime, timezone

import httpx
from psycopg.types.json import Jsonb

from . import geo
from .config import settings
from .derive import EXT, public_copy, workdir
from .feedkeys import check_delegation, public_b64, server_keys, sign
from .storage import get_storage, key_for, sha256_file

log = logging.getLogger("memlane.feed")
RECORD_SCHEMA = "memlane-feed-record/1"
INDEX_SCHEMA = "memlane-feed-index/1"


def _dump(obj) -> bytes:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")


# ---- public records ---------------------------------------------------------------------------------
def _files(frozen: list[dict], resolve) -> list[dict]:
    out = []
    for f in frozen:
        pub = resolve(f) if resolve else None
        if resolve and not pub:
            continue                      # couldn't make a clean copy: left out rather than published raw
        out.append({"kind": (pub or {}).get("kind") or ("image" if f["kind"] == "screenshot" else f["kind"]),
                    "label": f.get("label"), "provided_by": "contributor" if f["source"] == "intake_file" else "archive",
                    "url": (pub or {}).get("path"), "sha256": (pub or {}).get("sha256"),
                    "bytes": (pub or {}).get("bytes"), "mime": (pub or {}).get("mime"),
                    "original_sha256": f["source_sha256"], "manifest_sha256": f.get("manifest_sha256")})
    return out


def _public_date(value, precision):
    if not value:
        return None
    if len(str(value)) == 10:
        return geo.coarsen_date(value, precision or "day")
    return {"value": value, "precision": "month" if len(str(value)) == 7 else "year"}


def _note(n: dict) -> dict:
    """A community note of an incident: shown on the map as the submitter's voice, linked to the case."""
    loc = geo.snap(n.get("lat"), n.get("lng"), n.get("precision") or "none")
    if loc:
        loc["label"] = n.get("place_label")
    return {"public_id": n["public_id"], "text": {"vi": n.get("text_vi"), "en": n.get("text_en")},
            "category": n.get("category"), "date": _public_date(n.get("date"), n.get("date_precision")),
            "location": loc, "credit": n.get("credit") or None}


def public_record(pub_type: str, public_id: str, version: int, published_at, snap: dict, resolve) -> dict:
    """The public JSON for one publication. `resolve(frozen_file) -> {path, sha256, bytes, mime, kind}` gives the
    cleaned copy (None in previews). Only fields listed here ever leave the hub."""
    loc = geo.snap(snap.get("lat"), snap.get("lng"), snap.get("precision") or "none")
    if loc:
        loc["label"] = snap.get("place_label")
    elif snap.get("place_label") and snap.get("precision") != "none":
        loc = {"label": snap["place_label"], "precision": snap.get("precision")}
    base = {"schema": RECORD_SCHEMA, "type": pub_type, "public_id": public_id, "version": version,
            "published_at": published_at.isoformat() if isinstance(published_at, datetime) else published_at,
            "date": geo.coarsen_date(snap.get("date"), snap.get("date_precision") or "day")
            if snap.get("date") and len(str(snap["date"])) == 10 else
            ({"value": snap["date"], "precision": "month" if len(str(snap["date"])) == 7 else "year"}
             if snap.get("date") else None),
            "location": loc, "credit": snap.get("credit") or None}
    if pub_type == "memory":
        return {**base, "text": {"vi": snap.get("text_vi"), "en": snap.get("text_en")},
                "category": snap.get("category"), "case": snap.get("case_ref"),
                "legacy_id": snap.get("legacy_external_id"),
                "files": _files(snap.get("frozen_community_files") or [], resolve)}
    materials = []
    for m in snap.get("materials") or []:
        materials.append({
            "public_id": m.get("public_id"), "platform": m.get("platform"), "kind": m.get("kind"),
            "public_status": VERDICT.get(m.get("verdict"), "unknown"), "captured_at": m.get("captured_at"),
            "title": m.get("title"), "summary": {"vi": m.get("summary_vi"), "en": m.get("summary_en")},
            "original_url": m.get("original_url") if m.get("show_original_url", True) else None,
            "wayback_url": m.get("wayback_url"),
            "verification": {"manifest_sha256": m.get("manifest_sha256"), "archive": "MemoryLane capture"},
            "files": _files(m.get("frozen_files") or [], resolve)})
    return {**base, "title": {"vi": snap.get("title_vi"), "en": snap.get("title_en")},
            "summary": {"vi": snap.get("summary_vi"), "en": snap.get("summary_en")},
            "group": snap.get("group"), "tags": snap.get("tags") or [], "public_status": snap.get("public_status"),
            "materials": materials, "community_files": _files(snap.get("frozen_community_files") or [], resolve),
            "notes": [_note(n) for n in snap.get("frozen_notes") or []]}


VERDICT = {"complete": "archived", "partial": "partially_archived", "restricted": "restricted",
           "walled": "login_wall", "unavailable": "unavailable"}


# ---- feed stores ---------------------------------------------------------------------------------------
class LocalFeedStore:
    def __init__(self, root: str):
        self.root = pathlib.Path(root)

    def put(self, path: str, data: bytes, mime: str) -> None:
        dest = self.root / path
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_name(dest.name + ".part")
        tmp.write_bytes(data)
        os.replace(tmp, dest)

    def put_file(self, path: str, src: str, mime: str) -> None:
        if not (self.root / path).exists():
            self.put(path, pathlib.Path(src).read_bytes(), mime)

    def list(self, prefix: str) -> list[str]:
        d = self.root / prefix
        return [f"{prefix}{p.name}" for p in d.iterdir() if p.is_file()] if d.is_dir() else []

    def delete(self, path: str) -> None:
        (self.root / path).unlink(missing_ok=True)


class S3FeedStore:
    """A public bucket (Backblaze B2 behind Cloudflare, decision 5). Separate credentials from the artifact store."""

    def __init__(self):
        import boto3
        self.bucket, self.prefix = settings.feed_s3_bucket, settings.feed_s3_prefix
        self.client = boto3.client("s3", endpoint_url=settings.feed_s3_endpoint or None,
                                   region_name=settings.feed_s3_region or None,
                                   aws_access_key_id=settings.feed_s3_access_key or None,
                                   aws_secret_access_key=settings.feed_s3_secret_key or None)

    def _cache(self, path: str) -> str:
        return "public, max-age=31536000, immutable" if path.startswith("files/") else "public, max-age=60"

    def put(self, path: str, data: bytes, mime: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=self.prefix + path, Body=data, ContentType=mime,
                               CacheControl=self._cache(path))

    def put_file(self, path: str, src: str, mime: str) -> None:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self.prefix + path)
            return
        except Exception:  # noqa: BLE001 - not there yet
            pass
        self.client.upload_file(src, self.bucket, self.prefix + path,
                                ExtraArgs={"ContentType": mime, "CacheControl": self._cache(path)})

    def list(self, prefix: str) -> list[str]:
        out, token = [], None
        while True:
            kw = {"Bucket": self.bucket, "Prefix": self.prefix + prefix, **({"ContinuationToken": token} if token else {})}
            r = self.client.list_objects_v2(**kw)
            out += [o["Key"][len(self.prefix):] for o in r.get("Contents", [])]
            if not r.get("IsTruncated"):
                return out
            token = r["NextContinuationToken"]

    def delete(self, path: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self.prefix + path)


def get_feed_store():
    return S3FeedStore() if settings.feed_store == "s3" else LocalFeedStore(settings.feed_dir)


# ---- clean copies ------------------------------------------------------------------------------------------
async def public_file(conn, f: dict) -> dict | None:
    """The cleaned copy of one frozen file, made once per original (by its sha256)."""
    row = await (await conn.execute("SELECT * FROM capture.public_files WHERE source_sha256 = %s",
                                    (f["source_sha256"],))).fetchone()
    if row:
        return row
    table = "capture.artifacts" if f["source"] == "artifact" else "capture.intake_files"
    src = await (await conn.execute(f"SELECT storage_key, mime, sha256 FROM {table} WHERE id = %s",
                                    (f["id"],))).fetchone()
    if not src or src["sha256"] != f["source_sha256"]:
        return None

    def make():
        with workdir() as tmp:
            raw = os.path.join(tmp, "source" + os.path.splitext(src["storage_key"])[1])
            with get_storage().open(src["storage_key"]) as fin, open(raw, "wb") as fout:
                while chunk := fin.read(1 << 20):
                    fout.write(chunk)
            out, mime, kind = public_copy(raw, src["mime"] or "", tmp)
            sha, size = sha256_file(out)
            key = key_for(sha, EXT.get(mime, os.path.splitext(out)[1]))
            get_storage().put(out, key, mime)
            return sha, size, key, mime, kind

    try:
        sha, size, key, mime, kind = await asyncio.to_thread(make)
    except Exception as e:  # noqa: BLE001 - a file that can't be cleaned is not published
        log.warning("no public copy of %s %s: %s", f["source"], f["id"], e)
        return None
    await conn.execute("INSERT INTO capture.public_files (sha256, storage_key, mime, bytes, kind, source_sha256)"
                       " VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (sha256) DO NOTHING",
                       (sha, key, mime, size, kind, f["source_sha256"]))
    return {"sha256": sha, "storage_key": key, "mime": mime, "bytes": size, "kind": kind}


# ---- build -------------------------------------------------------------------------------------------------
async def build(pool) -> dict:
    """Write the whole feed. Returns a summary; raises if signing isn't configured or usable."""
    keys = server_keys(settings)
    if not keys:
        raise RuntimeError("feed signing is not configured (FEED_ONLINE_KEY, FEED_DELEGATION)")
    online, delegation, revocations = keys
    online_pub = public_b64(online)
    problem = check_delegation(delegation, delegation["root_public"], online_pub, revocations)
    if problem:
        raise RuntimeError(f"online key unusable: {problem}")
    store = get_feed_store()
    async with pool.connection() as conn:
        pubs = await (await conn.execute(
            "SELECT * FROM capture.publications WHERE version > 0 AND state IN ('published', 'withdrawn')"
            " ORDER BY published_at")).fetchall()
        prev = (await (await conn.execute("SELECT live_paths FROM capture.feed_state WHERE id = 1")).fetchone())["live_paths"]
        records, tombstones, used_files, paths_by_id = [], [], set(), {}
        for pb in pubs:
            if pb["state"] == "withdrawn":
                tombstones.append({"type": pb["type"], "public_id": pb["public_id"],
                                   "withdrawn_at": pb["withdrawn_at"].isoformat()})
                continue
            cleaned: dict[str, dict] = {}
            mine: list[str] = []
            for f in _all_frozen(pb["published"]):
                c = await public_file(conn, f)
                if c:
                    ext = EXT.get(c["mime"], "")
                    path = f"files/{c['sha256']}{ext}"
                    await asyncio.to_thread(_copy_to_store, store, c, path)
                    used_files.add(path)
                    mine.append(path)
                    cleaned[f["source_sha256"]] = {"path": path, "sha256": c["sha256"], "bytes": c["bytes"],
                                                   "mime": c["mime"], "kind": c["kind"]}
            rec = public_record(pb["type"], pb["public_id"], pb["version"], pb["published_at"], pb["published"],
                                resolve=lambda f, cl=cleaned: cl.get(f["source_sha256"]))
            data = _dump(rec)
            digest = hashlib.sha256(data).hexdigest()
            # Content-addressed: a new version is a new file, so the previous index still points at intact bytes.
            path = f"records/{pb['public_id']}.{digest[:16]}.json"
            await asyncio.to_thread(store.put, path, data, "application/json")
            records.append({"type": pb["type"], "public_id": pb["public_id"], "version": pb["version"],
                            "updated_at": pb["published_at"].isoformat(), "path": path,
                            "sha256": digest})
            paths_by_id[pb["public_id"]] = [path, *mine]

    keys_doc = {"schema": "memlane-feed-keys/1", "root_public": delegation["root_public"],
                "delegation": delegation, "revocations": revocations}
    await asyncio.to_thread(store.put, "keys.json", _dump(keys_doc), "application/json")
    index = _dump({"schema": INDEX_SCHEMA, "generated_at": datetime.now(timezone.utc).isoformat(),
                   "records": records, "tombstones": tombstones, "keys": "keys.json"})
    sig = _dump({"online_public": online_pub, "signature": sign(online, index)})
    await asyncio.to_thread(store.put, "index.json", index, "application/json")
    await asyncio.to_thread(store.put, "index.json.sig", sig, "application/json")

    # Remove whatever no live record uses any more, keeping the previous generation of records that are still
    # live for one more build (a reader of the old index can finish). Withdrawals take their media at once.
    withdrawn = {t["public_id"] for t in tombstones}
    keep = {p for ps in paths_by_id.values() for p in ps}
    keep |= {p for pid, ps in (prev or {}).items() if pid not in withdrawn for p in ps}
    stale = [p for p in await asyncio.to_thread(store.list, "records/") if p not in keep]
    stale += [p for p in await asyncio.to_thread(store.list, "files/") if p not in keep]
    for p in stale:
        await asyncio.to_thread(store.delete, p)
    async with pool.connection() as conn:
        await conn.execute("UPDATE capture.feed_state SET live_paths = %s WHERE id = 1", (Jsonb(paths_by_id),))
    return {"records": len(records), "tombstones": len(tombstones), "files": len(used_files), "deleted": len(stale),
            "index_sha256": hashlib.sha256(index).hexdigest()}


def _all_frozen(snap: dict) -> list[dict]:
    out = list(snap.get("frozen_community_files") or [])
    for m in snap.get("materials") or []:
        out += m.get("frozen_files") or []
    return out


def _copy_to_store(store, c: dict, path: str) -> None:
    import tempfile
    with tempfile.TemporaryDirectory(prefix="memlane-feed-") as tmp:
        local = os.path.join(tmp, "f")
        with get_storage().open(c["storage_key"]) as fin, open(local, "wb") as fout:
            while chunk := fin.read(1 << 20):
                fout.write(chunk)
        store.put_file(path, local, c["mime"])


async def run_if_dirty(pool) -> bool:
    """Called by the worker. True if a build ran."""
    async with pool.connection() as conn:
        s = await (await conn.execute("UPDATE capture.feed_state SET dirty = false WHERE id = 1 AND dirty"
                                      " RETURNING id")).fetchone()
    if not s:
        return False
    try:
        summary = await build(pool)
    except Exception as e:  # noqa: BLE001
        log.error("feed build failed: %s", e)
        async with pool.connection() as conn:
            # Stay dirty only for transient errors; configuration errors would loop. Retried on the next change
            # or by "rebuild" in the admin page.
            await conn.execute("UPDATE capture.feed_state SET error = %s WHERE id = 1", (str(e)[:1000],))
        return True
    async with pool.connection() as conn:
        await conn.execute("UPDATE capture.feed_state SET built_at = now(), index_sha256 = %s, error = NULL WHERE id = 1",
                           (summary["index_sha256"],))
    log.info("feed built: %s", summary)
    for url in settings.feed_webhooks:
        try:
            async with httpx.AsyncClient(timeout=10) as c:
                await c.post(url, json={"index_sha256": summary["index_sha256"]})
        except Exception as e:  # noqa: BLE001 - only a nudge
            log.warning("feed webhook %s failed: %s", url, e)
    return True

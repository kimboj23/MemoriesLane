"""Background upkeep, one loop in the worker (worker._upkeep_loop):

- trusted timestamps (RFC 3161, tsa.py) for every sealed capture's manifest hash, from each authority in
  TIMESTAMP_TSAS, retried with backoff;
- photo fingerprints (phash.py) for captured photos and community photos, to spot duplicates;
- the canary: the known links in CANARY_FILE captured *without storing anything*, each verdict compared with the
  expected one (shown in Admin; a worse one raises an alert there). It runs when someone presses "Chạy kiểm tra
  ngay" in Admin (canary_requests), and on a schedule only if CANARY_INTERVAL_H is set (off by default).
  Threads/Instagram canaries go through the residential proxy: about 0.5 MB of paid traffic per link per run.
"""

import asyncio
import hashlib
import io
import json
import logging
import os
import tempfile
from datetime import datetime, timezone

from psycopg.types.json import Jsonb

from . import phash, tsa
from .config import settings
from .storage import get_storage, key_for

log = logging.getLogger("memlane.upkeep")

RANK = {"failed": 0, "walled": 1, "restricted": 1, "unavailable": 1, "partial": 2, "complete": 3}


# ---- trusted timestamps -------------------------------------------------------------------------------
async def stamp(pool, batch: int = 10) -> int:
    tsas = [t.strip() for t in settings.timestamp_tsas.split(",") if t.strip()]
    if not tsas:
        return 0
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO capture.capture_timestamps (capture_id, tsa) SELECT c.id, t FROM capture.captures c"
            " CROSS JOIN unnest(%s::text[]) t WHERE c.state = 'done' AND c.manifest_sha256 IS NOT NULL"
            " ON CONFLICT DO NOTHING", (tsas,))
        rows = await (await conn.execute(
            "SELECT t.capture_id, t.tsa, t.attempts, c.manifest_sha256 FROM capture.capture_timestamps t"
            " JOIN capture.captures c ON c.id = t.capture_id WHERE t.state = 'pending'"
            "   AND t.updated_at <= now() - make_interval(mins => (2 ^ t.attempts)::int - 1)"
            " ORDER BY t.updated_at LIMIT %s", (batch,))).fetchall()
    done = 0
    for r in rows:
        try:
            der, gen_time = await asyncio.to_thread(tsa.request_timestamp, r["tsa"], r["manifest_sha256"])
            sha = hashlib.sha256(der).hexdigest()
            key = key_for(sha, ".tsr")
            with tempfile.NamedTemporaryFile(delete=False, suffix=".tsr") as f:
                f.write(der)
            try:
                await asyncio.to_thread(get_storage().put, f.name, key, "application/timestamp-reply")
            finally:
                os.unlink(f.name)
            sql, args = ("UPDATE capture.capture_timestamps SET state = 'done', token_key = %s, token_sha256 = %s,"
                         " gen_time = %s, error = NULL, updated_at = now() WHERE capture_id = %s AND tsa = %s",
                         (key, sha, gen_time, r["capture_id"], r["tsa"]))
            done += 1
        except Exception as e:  # noqa: BLE001 - an authority being down must not stop the others
            sql, args = ("UPDATE capture.capture_timestamps SET attempts = attempts + 1, error = %s, updated_at = now(),"
                         " state = CASE WHEN attempts + 1 >= 8 THEN 'error' ELSE 'pending' END"
                         " WHERE capture_id = %s AND tsa = %s", (f"{type(e).__name__}: {e}"[:300], r["capture_id"], r["tsa"]))
        async with pool.connection() as conn:
            await conn.execute(sql, args)
    return done


# ---- photo fingerprints -------------------------------------------------------------------------------
def _hash_stored(key: str) -> int:
    f = get_storage().open(key)
    try:
        data = f.read()
    finally:
        f.close()
    return phash.dhash(io.BytesIO(data))


async def fingerprint(pool, batch: int = 50) -> int:
    """Photos without a fingerprint yet. 0 marks one that couldn't be read (never matched)."""
    n = 0
    for table, where in (("artifacts", "kind = 'image' AND storage_key IS NOT NULL"),
                         ("intake_files", "kind = 'image' AND state = 'stored' AND storage_key IS NOT NULL")):
        async with pool.connection() as conn:
            rows = await (await conn.execute(
                f"SELECT id, storage_key FROM capture.{table} WHERE phash IS NULL AND {where} LIMIT %s",
                (batch,))).fetchall()
        for r in rows:
            try:
                h = await asyncio.to_thread(_hash_stored, r["storage_key"])
            except Exception:  # noqa: BLE001 - not a readable image
                h = 0
            async with pool.connection() as conn:
                await conn.execute(f"UPDATE capture.{table} SET phash = %s WHERE id = %s", (h, r["id"]))
            n += 1
    return n


# ---- the scheduled canary -----------------------------------------------------------------------------
def load_canary() -> list[dict]:
    try:
        with open(settings.canary_file, encoding="utf-8") as f:
            return [c for c in json.load(f) if c.get("url") and c.get("min") in RANK]
    except (OSError, ValueError):
        return []


PAID_MB_PER_LINK = 0.5    # measured 2026-10-21 for Threads/Instagram through the proxy


def proxied_links(links: list[dict]) -> int:
    """How many canary links would go through the paid proxy (for the cost shown next to the Run button)."""
    from .egress import for_capture
    from .urls import classify
    return sum(1 for c in links if for_capture(classify(c["url"]).platform).url)


async def canary_if_due(pool, browsers) -> int:
    """The schedule, only if CANARY_INTERVAL_H is set (off by default)."""
    if settings.canary_interval_h <= 0:
        return 0
    links = load_canary()
    if not links:
        return 0
    async with pool.connection() as conn:
        last = (await (await conn.execute("SELECT max(run_at) AS t FROM capture.canary_runs")).fetchone())["t"]
    now = datetime.now(timezone.utc)
    if last and (now - last).total_seconds() < settings.canary_interval_h * 3600:
        return 0
    return await run_canary(pool, browsers, links)


async def canary_requested(pool, browsers) -> int:
    """A run someone asked for in Admin (health.py): take it, run it, mark it done."""
    async with pool.connection() as conn:
        req = await (await conn.execute(
            "UPDATE capture.canary_requests SET started_at = now() WHERE id = (SELECT id FROM capture.canary_requests"
            " WHERE started_at IS NULL AND finished_at IS NULL ORDER BY requested_at LIMIT 1) RETURNING id")).fetchone()
    if not req:
        return 0
    links, error = load_canary(), None
    try:
        if not links:
            error = "no canary links (CANARY_FILE)"
        else:
            await run_canary(pool, browsers, links)
    except Exception as e:  # noqa: BLE001
        error = f"{type(e).__name__}: {e}"[:300]
        log.exception("requested canary run failed")
    async with pool.connection() as conn:
        await conn.execute("UPDATE capture.canary_requests SET finished_at = now(), links = %s, error = %s WHERE id = %s",
                           (len(links), error, req["id"]))
    return len(links)


async def run_canary(pool, browsers, links: list[dict]) -> int:
    now = datetime.now(timezone.utc)
    from .pipeline import probe
    browser = await browsers.get()
    for c in links:
        try:
            v, platform, egress_label, seconds = await probe(browser, c["url"])
            verdict, reasons = ("rate_limited" if v.rate_limited else v.verdict), v.reasons
        except Exception as e:  # noqa: BLE001
            verdict, reasons, platform, egress_label, seconds = "failed", [f"{type(e).__name__}: {e}"[:200]], None, None, None
        ok = RANK.get("failed" if verdict == "rate_limited" else verdict, 0) >= RANK[c["min"]]
        async with pool.connection() as conn:
            await conn.execute(
                "INSERT INTO capture.canary_runs (run_at, link_sha256, note, platform, expected, verdict, ok, reasons,"
                " egress, seconds) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                (now, hashlib.sha256(c["url"].encode()).hexdigest(), (c.get("note") or "")[:200], platform, c["min"],
                 verdict, ok, Jsonb(reasons[:5]), egress_label, seconds))
        log.info("canary %s %s -> %s (%s)", platform, (c.get("note") or "")[:40], verdict, "ok" if ok else "WORSE")
    return len(links)

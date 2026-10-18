"""Capture worker: claims queued captures from Postgres and runs them.

    python -m memlane_capture.worker

The queue is the `capture.captures` table itself (state='queued'), claimed
with FOR UPDATE SKIP LOCKED, so any number of worker processes can run
side by side. One Chromium per process; each capture gets its own context.
"""

import asyncio
import logging
import os
import signal
import socket

from playwright.async_api import async_playwright
from psycopg.types.json import Jsonb

from .config import settings
from .db import make_pool, migrate
from .pipeline import run_capture, tool_versions
from .external import queue_wayback, run_one as run_external
from .inbox_core import add_update
from .seal import public_extracted

log = logging.getLogger("memlane.worker")
WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"

CLAIM_SQL = """
UPDATE capture.captures c
   SET state = 'running', started_at = now(), attempts = attempts + 1, claimed_by = %s, error = NULL
 WHERE c.id = (SELECT id FROM capture.captures
                WHERE state = 'queued' AND run_after <= now()
                ORDER BY run_after, created_at
                FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING c.*
"""


async def recover_stuck(pool) -> int:
    async with pool.connection() as conn:
        cur = await conn.execute(
            "UPDATE capture.captures SET state = 'queued', claimed_by = NULL "
            "WHERE state = 'running' AND started_at < now() - make_interval(mins => %s)",
            (settings.stuck_after_minutes,))
        return cur.rowcount


async def _claim(pool) -> tuple[dict, dict] | None:
    async with pool.connection() as conn:
        async with conn.transaction():
            cap = await (await conn.execute(CLAIM_SQL, (WORKER_ID,))).fetchone()
            if not cap:
                return None
            item = await (await conn.execute("SELECT * FROM capture.items WHERE id = %s", (cap["item_id"],))).fetchone()
            await conn.execute("UPDATE capture.items SET status = 'capturing', updated_at = now() WHERE id = %s",
                               (item["id"],))
            return cap, item


async def _finish(pool, cap: dict, item: dict, outcome) -> None:
    v = outcome.verdict
    retry = v.verdict == "failed" and cap["attempts"] < cap["max_attempts"]
    extracted = public_extracted(v.extracted)
    async with pool.connection() as conn:
        async with conn.transaction():
            # A failed attempt that will be retried records nothing: only the final attempt's files belong to it.
            for a in ([] if retry else outcome.sealed["artifacts"]):
                await conn.execute(
                    "INSERT INTO capture.artifacts (capture_id, witness, kind, role, label, sha256, bytes, mime,"
                    " storage_key, source_url, width, height, duration_s, meta)"
                    " VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
                    (cap["id"], a["witness"], a["kind"], a["role"], a["label"], a["sha256"], a["bytes"], a["mime"],
                     a["storage_key"], a["source_url"], a["width"], a["height"], a["duration_s"], Jsonb(a["meta"])))
            await conn.execute(
                "UPDATE capture.captures SET state = %s, verdict = %s, verdict_reasons = %s, finished_at = %s,"
                " final_url = %s, extracted = %s, witnesses = %s, tool_versions = %s, manifest_key = %s,"
                " manifest_sha256 = %s, run_after = CASE WHEN %s THEN now() + make_interval(mins => %s) ELSE run_after END"
                " WHERE id = %s",
                ("queued" if retry else "done", None if retry else v.verdict, Jsonb(v.reasons),
                 outcome.sealed["finished_at"], outcome.final_url, Jsonb(extracted),
                 Jsonb([r.summary() for r in outcome.results.values()]), Jsonb(tool_versions(outcome.results)),
                 None if retry else outcome.sealed["manifest_key"], None if retry else outcome.sealed["manifest_sha256"],
                 retry, 2 ** cap["attempts"], cap["id"]))
            await conn.execute(
                "UPDATE capture.items SET status = %s, latest_capture_id = %s, resolved_url = COALESCE(%s, resolved_url),"
                " platform = %s, kind = %s, title = COALESCE(title, %s), updated_at = now() WHERE id = %s",
                ("queued" if retry else v.verdict, cap["id"], outcome.resolved_url, outcome.platform, outcome.kind,
                 (extracted.get("title") or "")[:300] or None, item["id"]))
            if not retry:
                # Source material of an incident: the result goes into its feed (as "the system") and
                # notifies whoever follows the incident.
                links = await (await conn.execute("SELECT incident_id FROM capture.item_incidents WHERE item_id = %s",
                                                  (item["id"],))).fetchall()
                for link in links:   # every incident using this link
                    await add_update(conn, incident_id=link["incident_id"], kind="capture", item_id=item["id"],
                                     new={"verdict": v.verdict, "capture_id": str(cap["id"])},
                                     body="; ".join(v.reasons)[:1000])
                if v.verdict != "failed":
                    await queue_wayback(conn, item["id"])
    log.info("capture %s %s -> %s%s (%s)", cap["id"], item["canonical_url"], v.verdict,
             " (will retry)" if retry else "", "; ".join(v.reasons)[:200])


async def _crash(pool, cap: dict, item: dict, err: str) -> None:
    retry = cap["attempts"] < cap["max_attempts"]
    async with pool.connection() as conn:
        async with conn.transaction():
            await conn.execute(
                "UPDATE capture.captures SET state = %s, verdict = %s, error = %s, finished_at = now(),"
                " run_after = now() + make_interval(mins => %s) WHERE id = %s",
                ("queued" if retry else "done", None if retry else "failed", err[:2000], 2 ** cap["attempts"], cap["id"]))
            await conn.execute("UPDATE capture.items SET status = %s, latest_capture_id = %s, updated_at = now()"
                               " WHERE id = %s", ("queued" if retry else "failed", cap["id"], item["id"]))
    log.error("capture %s crashed (%s): %s", cap["id"], "will retry" if retry else "giving up", err[:300])


class BrowserHolder:
    """One Chromium per process, relaunched if it dies."""

    def __init__(self, pw):
        self.pw, self.browser, self.lock = pw, None, asyncio.Lock()

    async def get(self):
        async with self.lock:
            if self.browser is None or not self.browser.is_connected():
                self.browser = await self.pw.chromium.launch(args=["--disable-dev-shm-usage"])
                log.info("launched chromium %s", self.browser.version)
            return self.browser


async def _loop(pool, browsers: BrowserHolder, stop: asyncio.Event, slot: int) -> None:
    while not stop.is_set():
        try:
            claimed = await _claim(pool)
        except Exception:  # noqa: BLE001 - DB hiccup: back off and retry
            log.exception("claim failed")
            claimed = None
        if not claimed:
            try:
                await asyncio.wait_for(stop.wait(), settings.poll_seconds)
            except asyncio.TimeoutError:
                pass
            continue
        cap, item = claimed
        log.info("[slot %d] capture %s attempt %d: %s", slot, cap["id"], cap["attempts"], item["canonical_url"])
        try:
            outcome = await run_capture(await browsers.get(), item, cap)
            await _finish(pool, cap, item, outcome)
        except Exception as e:  # noqa: BLE001
            log.exception("capture %s crashed", cap["id"])
            await _crash(pool, cap, item, f"{type(e).__name__}: {e}")


async def _external_loop(pool, stop: asyncio.Event) -> None:
    """Internet Archive submissions: one at a time (SPN allows few concurrent jobs per account)."""
    while not stop.is_set():
        try:
            busy = await run_external(pool)
        except Exception:  # noqa: BLE001
            log.exception("external copy failed")
            busy = False
        if not busy:
            try:
                await asyncio.wait_for(stop.wait(), settings.poll_seconds * 3)
            except asyncio.TimeoutError:
                pass


async def main() -> None:
    logging.basicConfig(level=os.environ.get("LOG_LEVEL", "INFO"),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    pool = make_pool(max_size=settings.worker_concurrency + 2)
    await pool.open()
    applied = await migrate(pool)
    if applied:
        log.info("applied migrations: %s", ", ".join(applied))
    n = await recover_stuck(pool)
    if n:
        log.warning("requeued %d stuck capture(s)", n)

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # Windows
            pass

    async with async_playwright() as pw:
        browsers = BrowserHolder(pw)
        log.info("worker %s started: %d slot(s), storage=%s", WORKER_ID, settings.worker_concurrency,
                 settings.storage_backend)
        await asyncio.gather(*(_loop(pool, browsers, stop, i) for i in range(settings.worker_concurrency)),
                             _external_loop(pool, stop))
    await pool.close()


if __name__ == "__main__":
    asyncio.run(main())

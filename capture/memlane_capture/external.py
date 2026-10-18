"""External copies: the Internet Archive's Wayback Machine (Save Page Now 2).

A Wayback copy is an independent, public third-party copy. It is not part of our sealed capture, never
affects a verdict, and runs as its own job after the capture (SPN can take minutes, and is rate-limited).

When it is submitted:
  * automatically after a capture, if the item is filed under a project with "Share with the Internet
    Archive" switched on (Atlos's per-project setting, off by default: submissions are public), or if it is
    unfiled and WAYBACK_DEFAULT_UNFILED is on;
  * on demand, from the item page ("Gửi lên Internet Archive").

What is submitted depends on the platform (verified 2026-10-18):
  * Facebook posts/photos: the public embed page. Wayback stores the embed's author, text and photo, while
    the post URL itself gives it a login wall. Videos: the video embed.
  * Threads, Instagram: skipped. Wayback stored Threads' login/error pages ("?error=invalid_post") for
    every Threads link the old platform sent.
  * everything else: the canonical (resolved) URL.
"""

import asyncio
import logging
import time
from urllib.parse import quote

import httpx

from .config import settings

log = logging.getLogger("memlane.external")
POLL_SECONDS = 5
MAX_WAIT_SECONDS = 240
MAX_ATTEMPTS = 3


def configured() -> bool:
    return bool(settings.ia_access_key and settings.ia_secret_key)


def target_for(platform: str, kind: str, url: str) -> tuple[str | None, str | None]:
    """(url to submit, None) or (None, reason it is skipped)."""
    if platform in ("threads", "instagram"):
        return None, f"Wayback cannot capture {platform} posts (it stores the login/error page)"
    if platform == "facebook":
        if kind in ("post", "photo"):
            return f"https://www.facebook.com/plugins/post.php?href={quote(url, safe='')}&show_text=true&width=500", None
        if kind == "video":
            return f"https://www.facebook.com/plugins/video.php?href={quote(url, safe='')}&show_text=true&width=500", None
        return None, "Wayback gets a login wall for this kind of Facebook page"
    return url, None


async def queue_wayback(conn, item_id, requested_by=None, force: bool = False) -> dict | None:
    """Queue a Wayback copy for an item if policy allows (or `force`, an explicit request).

    Returns the external_copies row, or None if nothing was queued (not wanted, or one already exists).
    """
    # A link used in several incidents is sent if any of their projects shares with the Internet Archive.
    item = await (await conn.execute(
        "SELECT i.id, i.platform, i.kind, coalesce(i.resolved_url, i.canonical_url) AS url,"
        " (SELECT count(*) FROM capture.item_incidents ii WHERE ii.item_id = i.id) AS filed,"
        " EXISTS (SELECT 1 FROM capture.item_incidents ii JOIN capture.incidents inc ON inc.id = ii.incident_id"
        "         JOIN capture.projects p ON p.id = inc.project_id WHERE ii.item_id = i.id AND p.wayback_enabled)"
        " AS wayback_enabled FROM capture.items i WHERE i.id = %s", (item_id,))).fetchone()
    if not item:
        return None
    wanted = force or (item["wayback_enabled"] if item["filed"] else settings.wayback_default_unfiled)
    if not wanted:
        return None
    existing = await (await conn.execute(
        "SELECT * FROM capture.external_copies WHERE item_id = %s AND service = 'wayback'"
        " AND (state IN ('queued', 'running') OR (state = 'done' AND NOT %s)) ORDER BY created_at DESC LIMIT 1",
        (item_id, force))).fetchone()
    if existing:
        return existing if force else None
    target, skip = target_for(item["platform"], item["kind"], item["url"])
    if not configured() and not skip:
        skip = "Internet Archive keys are not configured (IA_ACCESS_KEY / IA_SECRET_KEY)"
    return await (await conn.execute(
        "INSERT INTO capture.external_copies (item_id, submitted_url, state, error, requested_by, finished_at)"
        " VALUES (%s, %s, %s, %s, %s, CASE WHEN %s THEN now() END) RETURNING *",
        (item_id, target or item["url"], "skipped" if skip else "queued", skip, requested_by, bool(skip)))).fetchone()


async def submit(url: str, client: httpx.AsyncClient | None = None) -> tuple[str | None, str | None, bool]:
    """Run one SPN2 job. Returns (copy_url, error, retryable)."""
    # No browser User-Agent here: archive.org flagged spoofed UAs on its own API with HTTP 498.
    headers = {"Accept": "application/json",
               "Authorization": f"LOW {settings.ia_access_key}:{settings.ia_secret_key}"}
    own = client is None
    client = client or httpx.AsyncClient(timeout=30)
    base = settings.spn_base.rstrip("/")
    try:
        r = await client.post(f"{base}/save", headers=headers,
                              data={"url": url, "skip_first_archive": "1", "capture_all": "1"})
        if r.status_code in (429, 502, 503, 504):
            return None, f"SPN busy: HTTP {r.status_code}", True
        try:
            job = r.json()
        except ValueError:
            return None, f"SPN submit failed: HTTP {r.status_code}", r.status_code >= 500
        if not job.get("job_id"):
            msg = job.get("message") or job.get("status_ext") or str(job)[:200]
            return None, f"SPN refused: {msg}", "limit" in str(msg).lower()
        started = time.monotonic()
        while time.monotonic() - started < MAX_WAIT_SECONDS:
            await asyncio.sleep(POLL_SECONDS)
            s = (await client.get(f"{base}/save/status/{job['job_id']}", headers=headers)).json()
            if s.get("status") == "success":
                return f"https://web.archive.org/web/{s['timestamp']}/{s.get('original_url') or url}", None, False
            if s.get("status") == "error":
                ext = s.get("status_ext") or s.get("message") or "error"
                return None, f"SPN error: {ext}", ext in ("error:too-many-daily-captures", "error:user-session-limit")
        return None, "SPN timed out", True
    except (httpx.HTTPError, ValueError) as e:
        return None, f"SPN: {type(e).__name__}: {e}"[:300], True
    finally:
        if own:
            await client.aclose()


CLAIM_SQL = """
UPDATE capture.external_copies e SET state = 'running', attempts = attempts + 1
 WHERE e.id = (SELECT id FROM capture.external_copies WHERE state = 'queued' AND run_after <= now()
                ORDER BY run_after FOR UPDATE SKIP LOCKED LIMIT 1)
RETURNING e.*
"""


async def run_one(pool) -> bool:
    """Process one queued external copy. Returns False when the queue is empty."""
    async with pool.connection() as conn:
        job = await (await conn.execute(CLAIM_SQL)).fetchone()
    if not job:
        return False
    copy_url, error, retryable = await submit(job["submitted_url"])
    retry = bool(error) and retryable and job["attempts"] < MAX_ATTEMPTS
    async with pool.connection() as conn:
        await conn.execute(
            "UPDATE capture.external_copies SET state = %s, copy_url = %s, error = %s,"
            " finished_at = CASE WHEN %s THEN NULL ELSE now() END,"
            " run_after = now() + make_interval(mins => %s) WHERE id = %s",
            ("queued" if retry else ("done" if copy_url else "error"), copy_url, error, retry,
             5 * 2 ** job["attempts"], job["id"]))
    log.info("wayback %s %s -> %s", job["id"], job["submitted_url"][:80], copy_url or error)
    return True

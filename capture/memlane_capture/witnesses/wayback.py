"""Wayback witness: an independent third-party copy via Internet Archive SPN2.

Always a *context* artifact. It never makes a capture "complete" on its own
(proposal §6.2). Skipped for Meta platforms: Wayback stores their login/error
pages instead of the post (seven Threads URLs in production were "archived"
as threads.com/?error=invalid_post).
"""

import asyncio
import time

import httpx

from ..config import settings
from ..models import ArtifactDraft, WitnessResult

SKIP_PLATFORMS = {"facebook", "instagram", "threads"}
POLL_SECONDS = 5
MAX_WAIT_SECONDS = 180


def enabled() -> bool:
    return settings.wayback_enabled and bool(settings.ia_access_key and settings.ia_secret_key)


async def run(url: str, platform: str) -> WitnessResult:
    res = WitnessResult(name="wayback", tool_version="SPN2")
    if not enabled():
        res.error, res.signals["skipped"] = "skipped: IA keys not configured", True
        return res
    if platform in SKIP_PLATFORMS:
        res.error, res.signals["skipped"] = f"skipped: Wayback cannot capture {platform}", True
        return res

    # No browser User-Agent here: archive.org flagged spoofed UAs on its own API with HTTP 498.
    headers = {"Accept": "application/json",
               "Authorization": f"LOW {settings.ia_access_key}:{settings.ia_secret_key}"}
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=30, headers=headers) as client:
            r = await client.post("https://web.archive.org/save",
                                  data={"url": url, "skip_first_archive": "1", "capture_all": "1"})
            job = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
            if not job.get("job_id"):
                res.error = f"SPN submit failed: HTTP {r.status_code} {str(job or r.text)[:200]}"
                res.signals["http_status"] = r.status_code
                return res
            while time.monotonic() - started < MAX_WAIT_SECONDS:
                await asyncio.sleep(POLL_SECONDS)
                s = (await client.get(f"https://web.archive.org/save/status/{job['job_id']}")).json()
                if s.get("status") == "success":
                    wb = f"https://web.archive.org/web/{s['timestamp']}/{s.get('original_url') or url}"
                    res.final_url = s.get("original_url")
                    res.artifacts.append(ArtifactDraft("link", "context", "wayback", source_url=wb,
                                                       meta={"timestamp": s["timestamp"],
                                                             "original_url": s.get("original_url")}))
                    res.ok = True
                    return res
                if s.get("status") == "error":
                    res.error = f"SPN error: {s.get('status_ext') or s.get('message')}"
                    return res
            res.error = "SPN timed out"
    except (httpx.HTTPError, ValueError) as e:
        res.error = f"SPN: {type(e).__name__}: {e}"[:300]
    finally:
        res.seconds = time.monotonic() - started
    return res

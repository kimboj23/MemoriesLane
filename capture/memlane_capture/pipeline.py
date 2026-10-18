"""One capture, end to end: resolve -> classify -> witnesses in parallel -> gate -> seal."""

import asyncio
import logging
import os
import shutil
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone

import yt_dlp
from playwright.async_api import Browser

from . import gate, seal
from .config import settings
from .models import Verdict, WitnessResult
from .resolve import resolve
from .urls import canonicalize, classify, is_login_url, needs_resolution
from .witnesses import media, view, wayback

log = logging.getLogger("memlane.pipeline")


@dataclass
class Outcome:
    verdict: Verdict
    results: dict[str, WitnessResult]
    sealed: dict
    final_url: str | None
    resolved_url: str | None
    platform: str
    kind: str


async def _guard(name: str, coro, timeout: float) -> WitnessResult:
    """A witness that crashes or hangs becomes a failed result, never a failed capture."""
    try:
        return await asyncio.wait_for(coro, timeout)
    except asyncio.TimeoutError:
        return WitnessResult(name=name, error=f"timed out after {int(timeout)}s")
    except Exception as e:  # noqa: BLE001 - isolate witness bugs from each other
        log.exception("witness %s crashed", name)
        return WitnessResult(name=name, error=f"{type(e).__name__}: {e}"[:300])


async def run_capture(browser: Browser, item: dict, capture: dict) -> Outcome:
    started_at = datetime.now(timezone.utc)
    os.makedirs(settings.work_dir, exist_ok=True)
    work = tempfile.mkdtemp(prefix=f"cap-{capture['id']}-", dir=settings.work_dir)
    try:
        url = item.get("resolved_url") or item["canonical_url"]
        resolved = item.get("resolved_url")
        if not resolved and needs_resolution(url):
            resolved = await resolve(url)
            if resolved:
                url = resolved
        cls = classify(url)

        tasks = {
            "media": _guard("media", asyncio.to_thread(media.run, url, cls.platform, cls.kind, work),
                            settings.media_timeout_s),
            "view": _guard("view", view.run(browser, url, cls.platform, cls.kind, os.path.join(work, "view")),
                           settings.view_timeout_s * 3),
            "wayback": _guard("wayback", wayback.run(url, cls.platform), 240),
        }
        done = await asyncio.gather(*tasks.values())
        results = dict(zip(tasks.keys(), done))

        # A share link nobody could resolve over HTTP: the real browser's final URL is the next best thing.
        v = results["view"]
        if not resolved and needs_resolution(item["canonical_url"]) and v.final_url and not is_login_url(v.final_url):
            canon = canonicalize(v.final_url)
            if canon != item["canonical_url"]:
                resolved = canon
                cls = classify(canon)

        verdict = gate.judge(cls.platform, cls.kind, results)
        final_url = v.final_url or results["media"].final_url
        sealed = await asyncio.to_thread(
            seal.seal, work_dir=work, item={**item, "platform": cls.platform, "kind": cls.kind}, capture=capture,
            results=results, verdict=verdict, final_url=final_url, resolved_url=resolved, started_at=started_at)
        return Outcome(verdict, results, sealed, final_url, resolved, cls.platform, cls.kind)
    finally:
        shutil.rmtree(work, ignore_errors=True)


def tool_versions(results: dict[str, WitnessResult]) -> dict:
    versions = {name: r.tool_version for name, r in results.items() if r.tool_version}
    versions.setdefault("media", f"yt-dlp {yt_dlp.version.__version__}")
    return versions

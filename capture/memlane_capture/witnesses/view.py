"""View witness: what a real browser shows, logged out.

Per capture, in a fresh browser context:
  1. the page "as served" (viewport screenshot + HTML + text): evidence of
     exactly what the site returned, including any login/consent wall;
  2. the page "cleaned": modal dialogs removed, full-page screenshot, text;
  3. for Facebook / Threads / Instagram, the platform's own *embed* page,
     which renders public posts without login (verified 2026-10-18), plus
     the post's own images downloaded from it.
"""

import json
import os
import re
import time
from urllib.parse import quote, urlsplit

from playwright.async_api import Browser, BrowserContext, Page
from playwright.async_api import Error as PWError
from playwright.async_api import TimeoutError as PWTimeout

from .. import wacz as wacz_mod
from ..config import settings
from ..gate import RESTRICTED_PHRASES
from ..models import ArtifactDraft, WitnessResult
from ..urls import canonicalize, is_login_url

VIEWPORT = {"width": 1280, "height": 900}
EMBED_WIDTH = 560
MAX_SHOT_HEIGHT = 12000
MIN_MEDIA_PX = 200          # images narrower than this are avatars/icons, not post content
MAX_MEDIA_BYTES = 200 * 1024 * 1024
# Profile pictures and UI sprites, never post content: Instagram/Threads "-19/" assets,
# Facebook "t39.30808-1/" avatars, Facebook rsrc.php static images.
_AVATAR_URL = re.compile(r"/v/t51\.\d+-19/|/v/t39\.30808-1/|/rsrc\.php/")

_STRIP_OVERLAYS_JS = """
() => {
  let removed = 0;
  document.querySelectorAll('[role="dialog"], [aria-modal="true"]').forEach(el => { el.remove(); removed++; });
  const vw = innerWidth, vh = innerHeight;
  const translucent = (c) => { const m = /rgba\\([^)]*,\\s*([\\d.]+)\\)/.exec(c); return m && +m[1] > 0 && +m[1] < 1; };
  for (const el of document.querySelectorAll('body *')) {
    if (!el.isConnected) continue;
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' && cs.position !== 'sticky') continue;
    const r = el.getBoundingClientRect();
    if (r.width * r.height <= 0.3 * vw * vh) continue;
    // a large fixed layer that sits on top, or a dimming backdrop (semi-transparent background)
    if ((parseInt(cs.zIndex) || 0) > 0 || translucent(cs.backgroundColor)) { el.remove(); removed++; }
  }
  for (const el of [document.documentElement, document.body]) {
    if (!el) continue;
    el.style.setProperty('overflow', 'auto', 'important');
    el.style.setProperty('position', 'static', 'important');
  }
  return removed;
}
"""

_META_JS = """
() => {
  const og = {};
  document.querySelectorAll('meta[property^="og:"], meta[name^="twitter:"], meta[name="description"], meta[name="author"], meta[property^="article:"]')
    .forEach(m => { const k = m.getAttribute('property') || m.getAttribute('name'); if (k && !(k in og)) og[k] = m.content || ''; });
  const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent).slice(0, 10);
  const t = document.querySelector('time[datetime]');
  const canonical = document.querySelector('link[rel="canonical"]');
  return { og, ld, time: t ? t.getAttribute('datetime') : null, canonical: canonical ? canonical.href : null,
           title: document.title || '' };
}
"""

_MEDIA_JS = """
(minPx) => {
  const out = [];
  for (const img of document.images) {
    const src = img.currentSrc || img.src;
    if (src && src.startsWith('http') && img.naturalWidth >= minPx && img.naturalHeight >= minPx)
      out.push({ kind: 'image', src, w: img.naturalWidth, h: img.naturalHeight });
  }
  for (const v of document.querySelectorAll('video')) {
    const src = v.currentSrc || v.src || (v.querySelector('source') || {}).src;
    if (src) out.push({ kind: 'video', src, poster: v.poster || null, w: v.videoWidth, h: v.videoHeight });
  }
  return out;
}
"""


def embed_url(url: str, platform: str, kind: str) -> str | None:
    """The platform's public embed page for a post, or None."""
    if platform == "facebook" and kind in ("post", "photo"):
        return f"https://www.facebook.com/plugins/post.php?href={quote(url, safe='')}&show_text=true&width=500"
    if platform == "facebook" and kind == "video":
        return f"https://www.facebook.com/plugins/video.php?href={quote(url, safe='')}&show_text=true&width=500"
    if platform == "threads" and "/post/" in url:
        return url.rstrip("/") + "/embed"
    if platform == "instagram" and kind in ("post", "video"):
        m = re.match(r"https://www\.instagram\.com/(p|reel|tv)/([^/?#]+)", url)
        if m:
            return f"https://www.instagram.com/{m.group(1)}/{m.group(2)}/embed/captioned/"
    return None


async def _new_context(browser: Browser, proxy: dict | None = None, har_path: str | None = None) -> BrowserContext:
    kwargs = dict(viewport=VIEWPORT, locale=settings.locale, timezone_id=settings.timezone,
                  ignore_https_errors=True, service_workers="block",
                  extra_http_headers={"Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8"})
    if har_path:
        # Everything this visit fetched, with bodies, for the replayable archive (wacz.py). Written on close.
        kwargs.update(record_har_path=har_path, record_har_content="attach", record_har_mode="full")
    # Headful Chromium sends its own, genuine user agent; headless says "HeadlessChrome", so name it ourselves.
    if settings.user_agent_override or not settings.headful:
        kwargs["user_agent"] = settings.user_agent
    if proxy:
        kwargs["proxy"] = proxy
    return await browser.new_context(**kwargs)


async def _settle(page: Page, scroll: bool) -> None:
    try:
        await page.wait_for_load_state("networkidle", timeout=15000)
    except PWTimeout:
        pass
    if scroll:  # trigger lazy-loaded images on articles, then return to the top
        for _ in range(12):
            at_bottom = await page.evaluate(
                "() => { window.scrollBy(0, innerHeight); return innerHeight + scrollY >= document.body.scrollHeight - 5; }")
            await page.wait_for_timeout(250)
            if at_bottom:
                break
        await page.evaluate("() => window.scrollTo(0, 0)")
    await page.wait_for_timeout(2000)


async def _full_shot(page: Page, path: str) -> tuple[int, int]:
    height = await page.evaluate("() => Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)")
    height = int(height or VIEWPORT["height"])
    if height > MAX_SHOT_HEIGHT:
        await page.screenshot(path=path, full_page=True,
                              clip={"x": 0, "y": 0, "width": VIEWPORT["width"], "height": MAX_SHOT_HEIGHT})
        return VIEWPORT["width"], MAX_SHOT_HEIGHT
    await page.screenshot(path=path, full_page=True)
    return VIEWPORT["width"], height


def _write(path: str, text: str) -> str:
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    return path


def _ld_fields(ld_blobs: list[str]) -> dict:
    out = {}
    for blob in ld_blobs:
        try:
            data = json.loads(blob)
        except (ValueError, TypeError):
            continue
        for node in data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []:
            if not isinstance(node, dict):
                continue
            out.setdefault("headline", node.get("headline"))
            out.setdefault("article_body", node.get("articleBody"))
            out.setdefault("date_published", node.get("datePublished") or node.get("uploadDate"))
            author = node.get("author")
            if isinstance(author, list) and author:
                author = author[0]
            if isinstance(author, dict):
                out.setdefault("author", author.get("name"))
            elif isinstance(author, str):
                out.setdefault("author", author)
    return {k: v for k, v in out.items() if v}


def _ext_for(mime: str, url: str) -> str:
    mime = (mime or "").split(";")[0].strip().lower()
    table = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif",
             "image/heic": ".heic", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"}
    if mime in table:
        return table[mime]
    m = re.search(r"\.(jpe?g|png|webp|gif|mp4|webm|mov)(?:$|\?)", urlsplit(url).path, re.I)
    return "." + m.group(1).lower() if m else ".bin"


def _strip_byte_range(url: str) -> str:
    # Facebook/Instagram DASH segments carry bytestart/byteend; without them the CDN returns the whole file.
    return re.sub(r"([?&])(bytestart|byteend)=\d+&?", r"\1", url).rstrip("?&")


async def _download(context: BrowserContext, src: str, dest_base: str, referer: str) -> tuple[str, str] | None:
    try:
        resp = await context.request.get(_strip_byte_range(src), headers={"Referer": referer}, timeout=60000,
                                         max_redirects=5)
    except PWError:
        return None
    if not resp.ok:
        return None
    body = await resp.body()
    if len(body) < 5000 or len(body) > MAX_MEDIA_BYTES:
        return None
    mime = resp.headers.get("content-type", "")
    path = dest_base + _ext_for(mime, src)
    with open(path, "wb") as f:
        f.write(body)
    return path, mime.split(";")[0]


def _author_from(platform: str, url: str, og: dict, embed_text: str | None) -> str | None:
    if platform in ("threads", "instagram"):
        m = re.search(r"/@?([A-Za-z0-9._]+)/post/", url) if platform == "threads" else None
        if m:
            return "@" + m.group(1)
        m = re.search(r"\(?@([A-Za-z0-9._]+)\)?", og.get("og:title", ""))
        if m:
            return "@" + m.group(1)
    if platform == "facebook" and embed_text:
        first = embed_text.strip().split("\n", 1)[0].strip()
        if 0 < len(first) <= 80:
            return first
    return None


async def _capture_embed(context: BrowserContext, url: str, work_dir: str, res: WitnessResult) -> dict:
    page = await context.new_page()
    # Embeds are narrow cards: render them at phone-ish width so the screenshot is legible, not mostly blank.
    await page.set_viewport_size({"width": EMBED_WIDTH, "height": VIEWPORT["height"]})
    info: dict = {"url": url}
    try:
        resp = await page.goto(url, wait_until="domcontentloaded", timeout=settings.view_timeout_s * 1000)
        info["status"] = resp.status if resp else None
        await _settle(page, scroll=False)
        text = (await page.evaluate("() => document.body ? document.body.innerText : ''")) or ""
        info["text"] = text.strip()
        info["final_url"] = page.url
        # Clip the screenshot to the rendered content so it isn't a mostly-blank page.
        box = await page.evaluate(
            "() => { const r = document.body.getBoundingClientRect(); let h = 0;"
            " for (const el of document.body.querySelectorAll('*')) { const b = el.getBoundingClientRect();"
            " if (b.height > 0) h = Math.max(h, b.bottom + scrollY); } return Math.ceil(Math.min(h || r.height, 6000)); }")
        shot = os.path.join(work_dir, "embed.png")
        await page.screenshot(path=shot, full_page=True,
                              clip={"x": 0, "y": 0, "width": EMBED_WIDTH, "height": max(int(box or 600), 200)})
        res.artifacts.append(ArtifactDraft("screenshot", "primary", "embed", shot, mime="image/png", source_url=url))
        html = os.path.join(work_dir, "embed.html")
        _write(html, await page.content())
        res.artifacts.append(ArtifactDraft("html", "context", "embed-html", html, mime="text/html", source_url=url))

        media = await page.evaluate(_MEDIA_JS, MIN_MEDIA_PX)
        seen = set()
        for i, m in enumerate(media[:30]):
            src = m.get("src") or ""
            if not src.startswith("http") or src in seen or _AVATAR_URL.search(src):
                continue  # blob: video sources (MSE) can't be fetched; the media witness covers video
            seen.add(src)
            got = await _download(context, src, os.path.join(work_dir, f"embed-media-{i}"), url)
            if got:
                path, mime = got
                kind = "video" if mime.startswith("video/") else "image"
                res.artifacts.append(ArtifactDraft(kind, "primary", f"post-{kind}", path, mime=mime, source_url=src,
                                                   width=m.get("w") or None, height=m.get("h") or None))
        info["media_found"] = len(media)
    except (PWError, PWTimeout) as e:
        info["error"] = str(e).split("\n")[0][:300]
    finally:
        await page.close()
    return info


_SEE_WHY = re.compile(r"^\s*(xem lý do|see why|learn more|tìm hiểu thêm)\s*$", re.IGNORECASE)


async def _capture_restriction_notice(page: Page, served_text: str, work_dir: str, res: WitnessResult) -> str | None:
    """If the platform withholds the content ("This content isn't available to everyone"), open its
    "See why" explanation and keep it: for this archive the reason, e.g. "after a legal request",
    is evidence in its own right."""
    if not _has_any(served_text, RESTRICTED_PHRASES):
        return None
    res.signals["restricted_notice"] = True
    try:
        btn = page.get_by_text(_SEE_WHY).first
        if not await btn.count():
            btn = page.get_by_role("button", name=_SEE_WHY).first
        if not await btn.count():
            return served_text.strip()[:2000]
        await btn.click(timeout=5000)
        await page.wait_for_timeout(2500)
        text = (await page.evaluate(
            "() => { const d = document.querySelector('[role=\"dialog\"]'); return (d || document.body).innerText; }")) or ""
        shot = os.path.join(work_dir, "restriction-notice.png")
        await page.screenshot(path=shot)
        res.artifacts.append(ArtifactDraft("screenshot", "context", "restriction-notice", shot, mime="image/png",
                                           source_url=page.url))
        path = os.path.join(work_dir, "restriction-notice.txt")
        _write(path, text)
        res.artifacts.append(ArtifactDraft("text", "context", "restriction-notice-text", path,
                                           mime="text/plain; charset=utf-8"))
        await page.keyboard.press("Escape")
        await page.wait_for_timeout(500)
        return text.strip()[:4000]
    except (PWError, PWTimeout) as e:
        res.signals["restricted_notice_error"] = str(e).split("\n")[0][:200]
        return served_text.strip()[:2000]


def _has_any(text: str, phrases: list[str]) -> bool:
    t = (text or "").lower()
    return any(p in t for p in phrases)


async def run(browser: Browser, url: str, platform: str, kind: str, work_dir: str,
              proxy: dict | None = None) -> WitnessResult:
    res = WitnessResult(name="view", tool_version=f"chromium {browser.version}")
    res.signals["egress"] = "proxy" if proxy else "direct"
    os.makedirs(work_dir, exist_ok=True)
    started = time.monotonic()
    wanted = [p.strip() for p in settings.wacz_platforms.split(",") if p.strip()]
    har_path = (os.path.join(work_dir, "visit.har.zip")
                if settings.wacz and (not wanted or platform in wanted) else None)
    pages: list[dict] = []
    context = await _new_context(browser, proxy, har_path)
    try:
        page = await context.new_page()
        main_status = None
        try:
            resp = await page.goto(url, wait_until="domcontentloaded", timeout=settings.view_timeout_s * 1000)
            main_status = resp.status if resp else None
        except PWTimeout:
            res.signals["goto_timeout"] = True
        except PWError as e:
            res.error = str(e).split("\n")[0][:300]
            res.signals["navigation_error"] = True
            return res
        await _settle(page, scroll=platform in ("web", "document"))

        res.final_url = page.url
        res.signals.update({"http_status": main_status, "login_redirect": is_login_url(page.url)})

        served = os.path.join(work_dir, "served.png")
        await page.screenshot(path=served)
        res.artifacts.append(ArtifactDraft("screenshot", "context", "as-served", served, mime="image/png",
                                           source_url=page.url))
        html = os.path.join(work_dir, "page.html")
        _write(html, await page.content())
        res.artifacts.append(ArtifactDraft("html", "context", "page-html", html, mime="text/html",
                                           source_url=page.url))

        served_text = (await page.evaluate("() => document.body ? document.body.innerText : ''")) or ""
        meta = await page.evaluate(_META_JS)
        og = meta.get("og") or {}

        notice = await _capture_restriction_notice(page, served_text, work_dir, res)

        removed = await page.evaluate(_STRIP_OVERLAYS_JS)
        await page.wait_for_timeout(500)
        res.signals["overlays_removed"] = removed
        cleaned_text = (await page.evaluate("() => document.body ? document.body.innerText : ''")) or ""
        full = os.path.join(work_dir, "page.png")
        w, h = await _full_shot(page, full)
        # The cleaned page is the content itself for articles; for social posts the embed (below) is.
        res.artifacts.append(ArtifactDraft("screenshot", "primary" if platform in ("web", "document") else "context",
                                           "full-page", full, mime="image/png", width=w, height=h,
                                           source_url=page.url))
        text_path = os.path.join(work_dir, "page.txt")
        _write(text_path, cleaned_text)
        res.artifacts.append(ArtifactDraft("text", "primary" if platform in ("web", "document") else "context",
                                           "page-text", text_path, mime="text/plain; charset=utf-8"))
        meta_path = os.path.join(work_dir, "page-meta.json")
        _write(meta_path, json.dumps(meta, ensure_ascii=False, indent=2))
        res.artifacts.append(ArtifactDraft("metadata", "context", "page-meta", meta_path, mime="application/json"))
        await page.close()

        embed = None
        # Share links (threads.com/share, facebook.com/share/p) only resolve in the browser: embed the post the
        # browser landed on, canonicalised (tracking parameters dropped). A share URL in Facebook's embed plugin
        # gets "this post is no longer available" even for a public post.
        landed = canonicalize(res.final_url) if res.final_url and not is_login_url(res.final_url) else None
        e_url = embed_url(landed if platform in ("threads", "facebook") and landed else url, platform, kind)
        pages.append({"url": res.final_url, "title": meta.get("title")})
        if e_url:
            embed = await _capture_embed(context, e_url, work_dir, res)
            res.signals["embed"] = {k: v for k, v in embed.items() if k != "text"}
            pages.append({"url": e_url, "title": "embed"})

        ld = _ld_fields(meta.get("ld") or [])
        embed_text = (embed or {}).get("text") or None
        res.extracted = {k: v for k, v in {
            "title": og.get("og:title") or ld.get("headline") or meta.get("title"),
            "text": ld.get("article_body") or og.get("og:description") or og.get("description"),
            "embed_text": embed_text,
            "author": ld.get("author") or _author_from(platform, res.final_url or url, og, embed_text)
                      or og.get("author") or og.get("article:author"),
            "published_at": ld.get("date_published") or og.get("article:published_time") or meta.get("time"),
            "image": og.get("og:image"),
            "canonical": meta.get("canonical") or og.get("og:url"),
            "site_name": og.get("og:site_name"),
            "restriction_notice": notice,
            "page_text_chars": len(cleaned_text.strip()),
            # underscore keys are for the gate only and are not persisted
            "_served_text": served_text[:20000],
            "_cleaned_text": cleaned_text[:20000],
            "_page_title": meta.get("title") or "",
        }.items() if v not in (None, "")}
        res.ok = True
    except (PWError, PWTimeout) as e:
        res.error = str(e).split("\n")[0][:300]
    finally:
        res.seconds = time.monotonic() - started
        await context.close()
    if har_path and pages and os.path.exists(har_path):
        await _web_archive(res, har_path, work_dir, pages, browser.version)
    return res


async def _web_archive(res: WitnessResult, har_path: str, work_dir: str, pages: list[dict], version: str) -> None:
    """The visit as a WACZ (wacz.py). Never fails the witness: the archive is an extra, not the evidence."""
    import asyncio
    try:
        if os.path.getsize(har_path) > settings.wacz_max_mb * 1024 * 1024:
            res.signals["wacz"] = {"skipped": f"over {settings.wacz_max_mb} MB"}
            return
        out = os.path.join(work_dir, "visit.wacz")
        stats = await asyncio.to_thread(wacz_mod.har_to_wacz, har_path, out, pages=pages,
                                        software=f"MemoryLane capture (Playwright HAR, Chromium {version})")
        res.artifacts.append(ArtifactDraft("wacz", "context", "web-archive", out, mime="application/wacz"))
        res.signals["wacz"] = stats
    except Exception as e:  # noqa: BLE001
        res.signals["wacz"] = {"error": f"{type(e).__name__}: {e}"[:200]}
    finally:
        try:
            os.remove(har_path)
        except OSError:
            pass

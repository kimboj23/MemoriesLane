"""The quality gate: decide what a capture actually holds.

The old platform called anything that produced a file "archived", so login
walls, consent pages and thumbnails were filed as successes (proposal F1).
Here every capture gets one verdict, with reasons:

  complete     the primary content is there (author + full text, and the media for media posts)
  partial      some primary content (e.g. text cut at "Xem thêm", or a video without its caption)
  walled       no primary content; a login/consent/bot wall was served instead
  restricted   no primary content; the platform withholds it from this viewer or region, e.g. Meta's
               "restricted ... after a legal request". The notice itself is captured: evidence of censorship
  unavailable  no primary content; the platform says it is gone (itself evidence)
  failed       nothing usable, no clear reason (retried)

A Wayback link never upgrades a verdict (it is context only).
"""

import re

from .models import Verdict, WitnessResult

# Phrases that appear on walls, never in real post/article text. Lowercase.
# Sources: walls this archive actually hit (worker/botwall.js), the hosted
# auto-archiver's Facebook list, and the Vietnamese pages served to vi-VN.
SOCIAL_WALL_PHRASES = [
    # Facebook
    "you must log in to continue", "log in to facebook", "log into facebook", "see more on facebook",
    "see more from", "create new account", "forgotten password", "forgot account", "bạn quên tài khoản ư",
    "xem thêm trên facebook", "tạo tài khoản mới", "đăng nhập facebook", "quên mật khẩu",
    "we suspect automated behaviour", "we suspect automated behavior", "your account has been disabled",
    "confirm that this is your account", "we locked your account",
    # Threads / Instagram
    "log in or sign up for threads", "say more with threads", "đăng nhập hoặc đăng ký threads",
    "sign up to see photos and videos from", "log in to see photos and videos", "đăng ký để xem ảnh và video",
    # YouTube / Google consent
    "before you continue to youtube", "trước khi bạn tiếp tục truy cập youtube", "sign in to confirm you’re not a bot",
    "sign in to confirm you're not a bot",
]
# Bot/anti-crawler walls: the only wall phrases checked on ordinary web pages,
# whose real content often includes a site login box ("Quên mật khẩu").
BOT_WALL_PHRASES = [
    "confirm that you are human", "slide right to secure", "press and hold to confirm", "verify you are human",
    "checking your browser before accessing", "enable javascript and cookies to continue",
    "attention required! | cloudflare", "just a moment...", "pardon our interruption",
    "request unsuccessful. incapsula", "you've been blocked by network security",
]
WALL_PHRASES = SOCIAL_WALL_PHRASES + BOT_WALL_PHRASES

UNAVAILABLE_PHRASES = [
    "this content isn't available", "this content isn't available right now", "nội dung này hiện không khả dụng",
    "this page isn't available", "trang này hiện không khả dụng", "sorry, this page isn't available",
    "rất tiếc, trang này hiện không khả dụng", "video unavailable", "video không có sẵn", "this video has been removed",
    "this post is unavailable", "bài viết này không có sẵn", "thread không hiển thị", "post unavailable",
    "this account doesn’t exist", "this account doesn't exist", "page not found", "không tìm thấy trang",
    "không có thread", "thread unavailable",
]
# Withheld from this viewer/region rather than gone. Meta's wording (verified on a Threads post,
# 2026-10-18): "This content isn't available to everyone / It can't be seen by certain audiences",
# and behind "See why": "We received a legal request to restrict this content".
RESTRICTED_PHRASES = [
    "this content isn't available to everyone", "it can't be seen by certain audiences",
    "nội dung này không hiển thị với tất cả mọi người", "một số đối tượng không thể xem nội dung này",
    "we received a legal request to restrict", "chúng tôi nhận được yêu cầu pháp lý",
    "restricted access to the content", "đã hạn chế khả năng tiếp cận",
    "không hiển thị tại việt nam", "not available in vietnam", "restricted in your country",
    "not available in your country", "không có sẵn ở quốc gia", "do chúng tôi đáp ứng yêu cầu",
]
LEGAL_PHRASES = ["legal request", "yêu cầu pháp lý", "local law", "luật sở tại", "đáp ứng yêu cầu", "ministry"]

# Cut-off text: a "Xem thêm"/"See more" line anywhere (Facebook puts the like/comment
# counts after it), or a line ending in an ellipsis, optionally followed by "Xem thêm".
_TRUNCATION = re.compile(r"^\s*(xem thêm|see more)\s*$|(…|\.\.\.)\s*((xem thêm|see more)\s*)?$",
                         re.IGNORECASE | re.MULTILINE)


def _has(text: str, phrases: list[str]) -> list[str]:
    t = (text or "").lower()
    return [p for p in phrases if p in t]


def _text_ok(text: str | None) -> bool:
    """Real post text: not a platform notice ("Không có thread", a login prompt, a restriction message)."""
    return (bool(text) and len(text.strip()) >= 15 and not _has(text, WALL_PHRASES)
            and not _has(text, UNAVAILABLE_PHRASES) and not _has(text, RESTRICTED_PHRASES))


def merge_extracted(results: dict[str, WitnessResult]) -> dict:
    """Best-of content across witnesses: media (structured) first, then the browser view."""
    media = results.get("media").extracted if results.get("media") else {}
    view = results.get("view").extracted if results.get("view") else {}
    merged: dict = {}
    for key in ("author", "author_id", "author_url", "title", "published_at", "upload_date", "duration_s",
                "view_count", "like_count", "comment_count", "repost_count", "media_count"):
        val = media.get(key) if media.get(key) not in (None, "") else view.get(key)
        if val not in (None, ""):
            merged[key] = val
    texts = [t for t in (media.get("text"), view.get("text"), view.get("embed_text")) if _text_ok(t)]
    if texts:
        # Prefer the longest non-truncated text; fall back to the longest.
        full = [t for t in texts if not _TRUNCATION.search(t)]
        merged["text"] = max(full or texts, key=len)
        merged["text_truncated"] = not full
    for key in ("image", "canonical", "site_name", "page_text_chars", "embed_text"):
        if view.get(key) not in (None, ""):
            merged[key] = view[key]
    return merged


def judge(platform: str, kind: str, results: dict[str, WitnessResult]) -> Verdict:
    reasons: list[str] = []
    merged = merge_extracted(results)
    media = results.get("media")
    view = results.get("view")
    vx = view.extracted if view else {}

    primary = [a for r in results.values() for a in r.artifacts if a.role == "primary"]
    has_video = any(a.kind == "video" for a in primary)
    has_images = any(a.kind == "image" for a in primary)
    embed_shot = any(a.label == "embed" for a in primary)
    embed_text = vx.get("embed_text") or ""
    embed_ok = embed_shot and _text_ok(embed_text) and not _has(embed_text, UNAVAILABLE_PHRASES)
    text_ok = "text" in merged
    author_ok = bool(merged.get("author"))
    truncated = bool(merged.get("text_truncated"))

    served = " ".join([vx.get("_served_text", ""), vx.get("_page_title", "")])
    notice = vx.get("restriction_notice") or ""
    walls = _has(served, BOT_WALL_PHRASES if platform in ("web", "document") else WALL_PHRASES)
    restricted = _has(" ".join([served, embed_text, notice]), RESTRICTED_PHRASES)
    # "This content isn't available to everyone" also contains "this content isn't available":
    # when it is a restriction, it is not also a removal.
    unavailable = [] if restricted else _has(served + " " + embed_text, UNAVAILABLE_PHRASES)
    final_urls = " ".join(r.final_url or "" for r in results.values())
    if "error=invalid_post" in final_urls:
        unavailable.append("threads invalid_post")
    if view and view.signals.get("http_status") in (404, 410):
        unavailable.append(f"http {view.signals['http_status']}")
    if media and media.signals.get("unavailable"):
        unavailable.append("media: " + (media.error or "unavailable")[:80])
    login = bool(view and view.signals.get("login_redirect")) or bool(media and media.signals.get("login_required"))

    if walls:
        reasons.append("wall served (kept as evidence): " + ", ".join(walls[:3]))
    if login:
        reasons.append("login required")

    # What counts as the content depends on what kind of thing was saved.
    if platform in ("web", "document"):
        chars = vx.get("page_text_chars", 0) or 0
        if kind == "document" and any(a.kind in ("pdf",) for a in primary):
            content = "complete"
        elif chars >= 500 and not walls:
            content = "complete"
        elif chars >= 100 and not walls:
            content = "partial"
            reasons.append(f"little text on page ({chars} chars)")
        else:
            content = None
    elif kind == "video":
        if has_video and (author_ok or text_ok):
            content = "complete"
        elif has_video or embed_ok or (text_ok and has_images):
            content = "partial"
            reasons.append("video not downloaded" if not has_video else "video without author/caption")
        else:
            content = None
    elif kind in ("post", "photo"):
        if author_ok and text_ok and not truncated and (embed_ok or has_images or has_video):
            content = "complete"
        elif text_ok or has_images or has_video or embed_ok:
            content = "partial"
            if truncated:
                reasons.append("text truncated (needs a logged-in session for the full text)")
            if not author_ok:
                reasons.append("author not identified")
            if not (has_images or has_video or embed_ok):
                reasons.append("no media or embed captured")
        else:
            content = None
    else:  # profile / page / story
        content = "complete" if text_ok and not walls else ("partial" if text_ok else None)

    if content:
        if unavailable and content == "partial" and not (has_video or has_images):
            # e.g. an embed that only says "this content isn't available"
            reasons.append("platform reports content unavailable: " + ", ".join(unavailable[:2]))
            return Verdict("unavailable", reasons, merged)
        return Verdict(content, ["primary content captured"] + reasons if content == "complete" else reasons, merged)

    # HTTP 429: the platform refuses requests from this server for now (Meta does this to datacenter addresses).
    # Nothing was seen, so it is not a result: "failed" with a flag, and the worker retries much later.
    if (view and view.signals.get("http_status") == 429) or (media and media.signals.get("rate_limited")):
        return Verdict("failed", reasons + [f"rate-limited by {platform} (HTTP 429): the platform is refusing requests"
                                            " from this server for now"], merged, rate_limited=True)

    if restricted:
        legal = _has(notice + " " + served, LEGAL_PHRASES)
        why = ("restricted after a legal request (platform notice captured)" if legal
               else "restricted: not shown to this viewer/region")
        out = [why, "re-capture from another egress country or with a logged-in session may reach it"]
        if notice:
            merged["restriction_notice"] = notice[:2000]
        return Verdict("restricted", [r for r in reasons if not r.startswith("wall served")] + out, merged)
    if unavailable:
        return Verdict("unavailable", reasons + ["unavailable: " + ", ".join(unavailable[:3])], merged)
    if walls or login:
        return Verdict("walled", reasons, merged)
    errors = [f"{r.name}: {r.error}" for r in results.values() if r.error and not r.signals.get("skipped")]
    return Verdict("failed", reasons + (errors or ["no primary content captured"]), merged)

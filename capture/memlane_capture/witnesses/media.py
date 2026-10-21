"""Media witness: the video/audio/images themselves, via yt-dlp.

Two deliberate differences from how yt-dlp ran under ArchiveBox/auto-archiver:

* Filenames are `%(id).80B.%(ext)s`, capped in *bytes*. yt-dlp's default
  `<title> [<id>]` broke on every Facebook video with a long Vietnamese
  caption (title = caption, 2-3 bytes/char, > 255-byte filename limit).
* yt-dlp's own `.info.json` is never stored. With a cookies file it can carry
  the session cookies and signed request headers; a sanitised subset of the
  metadata is written instead.
"""

import json
import os
import time

import yt_dlp

from ..config import settings
from ..models import ArtifactDraft, WitnessResult

# Platforms where yt-dlp is worth trying. Threads is unsupported by yt-dlp
# (verified 2026-10-18); its media comes from the view witness instead.
SUPPORTED = {"facebook", "instagram", "tiktok", "youtube", "x"}

_VIDEO_EXT = {".mp4", ".webm", ".mkv", ".mov", ".m4v"}
_AUDIO_EXT = {".m4a", ".mp3", ".opus", ".ogg", ".aac"}
_IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic"}
_SUB_EXT = {".vtt", ".srt"}

_KEEP_FIELDS = (
    "id", "title", "fulltitle", "description", "uploader", "uploader_id", "uploader_url", "channel", "channel_id",
    "channel_url", "creator", "timestamp", "upload_date", "release_timestamp", "duration", "view_count",
    "like_count", "comment_count", "repost_count", "webpage_url", "original_url", "extractor_key", "thumbnail",
    "width", "height", "fps", "vcodec", "acodec", "ext", "format_id", "location", "tags", "categories",
    "availability", "live_status", "age_limit",
)


def _classify_error(msg: str) -> dict:
    m = msg.lower()
    if "unsupported url" in m:
        return {"unsupported": True}
    # Before "login": Instagram's rate-limit message also says "redirected to the login page" and "cookies".
    if "429" in m or "rate-limit" in m or "rate limit" in m or "too many requests" in m:
        return {"rate_limited": True}
    if any(s in m for s in ("registered users", "log in", "login", "cookies", "sign in to confirm", "authentication")):
        return {"login_required": True}
    if any(s in m for s in ("not available", "unavailable", "removed", "private video", "does not exist",
                            "http error 404", "http error 410", "content isn't available")):
        return {"unavailable": True}
    if "429" in m or "rate" in m and "limit" in m:
        return {"rate_limited": True}
    return {}


def _sanitise(info: dict) -> dict:
    out = {k: info.get(k) for k in _KEEP_FIELDS if info.get(k) is not None}
    if info.get("entries"):
        out["entries"] = [_sanitise(e) for e in info["entries"] if e]
    return out


def _extracted_from(info: dict) -> dict:
    first = (info.get("entries") or [info])[0] or info
    text = first.get("description") or info.get("description")
    title = first.get("title") or info.get("title")
    return {k: v for k, v in {
        "author": first.get("uploader") or first.get("channel") or first.get("creator"),
        "author_id": first.get("uploader_id") or first.get("channel_id"),
        "author_url": first.get("uploader_url") or first.get("channel_url"),
        "text": text,
        "title": title,
        "published_at": first.get("timestamp") or first.get("release_timestamp"),
        "upload_date": first.get("upload_date"),
        "duration_s": first.get("duration"),
        "view_count": first.get("view_count"),
        "like_count": first.get("like_count"),
        "comment_count": first.get("comment_count"),
        "repost_count": first.get("repost_count"),
        "media_count": len(info.get("entries") or [info]),
    }.items() if v not in (None, "")}


def run(url: str, platform: str, kind: str, work_dir: str, proxy: str | None = None) -> WitnessResult:
    """Blocking; the pipeline runs it in a thread."""
    res = WitnessResult(name="media", tool_version=f"yt-dlp {yt_dlp.version.__version__}")
    if platform not in SUPPORTED:
        res.error = "skipped: platform not supported by yt-dlp"
        res.signals["skipped"] = True
        return res

    out_dir = os.path.join(work_dir, "media")
    os.makedirs(out_dir, exist_ok=True)
    max_bytes = settings.media_max_mb * 1024 * 1024
    opts = {
        "outtmpl": {"default": os.path.join(out_dir, "%(id).80B.%(ext)s")},
        "restrictfilenames": True,
        "windowsfilenames": True,
        "format": f"bv*[filesize<?{max_bytes}]+ba/b[filesize<?{max_bytes}]/bv*+ba/b",
        "merge_output_format": "mp4",
        "max_filesize": max_bytes,
        "writethumbnail": True,
        "writeinfojson": False,
        "writesubtitles": True,
        "subtitleslangs": ["vi", "en", "-live_chat"],
        "noplaylist": platform not in ("instagram",),
        "playlistend": 30,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "socket_timeout": 30,
        "retries": 3,
        "fragment_retries": 3,
        "http_headers": {"Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8", "User-Agent": settings.user_agent},
    }
    if proxy:
        opts["proxy"] = proxy
    res.signals["egress"] = "proxy" if proxy else "direct"
    cookies = settings.cookies_for(platform)
    if cookies:
        opts["cookiefile"] = cookies
        res.signals["session"] = True

    started = time.monotonic()
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=True)
            info = ydl.sanitize_info(info) if info else {}
    except yt_dlp.utils.DownloadError as e:
        res.error = str(e).replace("\x1b[0;31mERROR:\x1b[0m ", "").strip()[:500]
        res.signals.update(_classify_error(res.error))
        res.seconds = time.monotonic() - started
        return res
    except Exception as e:  # yt-dlp extractor bugs surface as arbitrary exceptions
        res.error = f"{type(e).__name__}: {e}"[:500]
        res.seconds = time.monotonic() - started
        return res
    res.seconds = time.monotonic() - started

    res.final_url = info.get("webpage_url")
    res.extracted = _extracted_from(info)
    entries = info.get("entries") or [info]
    durations = {e.get("id"): e.get("duration") for e in entries if e}

    for name in sorted(os.listdir(out_dir)):
        path = os.path.join(out_dir, name)
        stem, ext = os.path.splitext(name)
        ext = ext.lower()
        media_id = stem.split(".")[0]
        if ext in _VIDEO_EXT:
            res.artifacts.append(ArtifactDraft("video", "primary", "video", path, source_url=url,
                                               duration_s=durations.get(media_id)))
        elif ext in _AUDIO_EXT:
            res.artifacts.append(ArtifactDraft("audio", "primary", "audio", path, source_url=url))
        elif ext in _IMAGE_EXT:
            # For video posts this is the thumbnail; for image posts (IG carousels) it's the content.
            is_video_post = any(a.kind == "video" for a in res.artifacts) or kind == "video"
            res.artifacts.append(ArtifactDraft("image", "context" if is_video_post else "primary",
                                               "thumbnail" if is_video_post else "image", path, source_url=url))
        elif ext in _SUB_EXT:
            res.artifacts.append(ArtifactDraft("text", "context", f"subtitles{os.path.splitext(stem)[1]}", path,
                                               mime="text/vtt" if ext == ".vtt" else "application/x-subrip"))

    # Thumbnails are written before the video finishes; re-mark them now that we know.
    if any(a.kind == "video" for a in res.artifacts):
        for a in res.artifacts:
            if a.kind == "image":
                a.role, a.label = "context", "thumbnail"

    meta_path = os.path.join(work_dir, "media-metadata.json")
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(_sanitise(info), f, ensure_ascii=False, indent=2, default=str)
    res.artifacts.append(ArtifactDraft("metadata", "context", "media-metadata", meta_path, mime="application/json"))

    res.ok = any(a.role == "primary" for a in res.artifacts)
    if not res.ok:
        res.error = "yt-dlp returned metadata but no media file"
    return res

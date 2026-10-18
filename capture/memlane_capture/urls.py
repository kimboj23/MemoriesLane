"""URL handling: pull a link out of shared text, canonicalise it, and classify it.

`canonicalize()` is the duplicate-detection key. It must be stable and
offline (no network): the inbox calls it before replying. Share links and
shorteners that can only be resolved over the network are flagged by
`needs_resolution()` and resolved later by the worker (resolve.py).
"""

import re
from dataclasses import dataclass
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlsplit, urlunsplit

# First http(s) URL in a blob of shared text ("Xem bài viết của X: https://... ").
_URL_RE = re.compile(r"https?://[^\s<>\"'`]+", re.IGNORECASE)
_TRAILING_PUNCT = ".,;:!?)]}>»”’…"

# Query parameters that never identify content: click/share trackers.
_TRACKING = {
    "fbclid", "gclid", "dclid", "msclkid", "yclid", "igsh", "igshid", "mibextid", "rdid", "share_url",
    "sfnsn", "xmt", "slof", "si", "feature", "ref", "ref_src", "ref_url", "_rdr", "_rdc", "hc_ref",
    "hc_location", "comment_tracking", "notif_id", "notif_t", "ref_type", "__xts__", "is_from_webapp",
    "sender_device", "web_id", "share_app_id", "share_link_id", "social_sharing", "embed_source", "spm",
}
_TRACKING_PREFIXES = ("utm_", "__cft__", "__tn__", "_nc_", "mc_", "pk_", "itm_", "vero_")

# Per-platform allowlists: on these hosts every other parameter is dropped.
_KEEP = {
    "facebook": {"story_fbid", "id", "fbid", "set", "v", "comment_id", "reply_comment_id", "multi_permalinks", "view"},
    "youtube": {"v", "list"},
    "instagram": set(),
    "threads": set(),
    "tiktok": set(),
    "x": set(),
}

_FB_HOSTS = {"facebook.com", "www.facebook.com", "m.facebook.com", "mbasic.facebook.com", "web.facebook.com",
             "touch.facebook.com", "mobile.facebook.com", "business.facebook.com", "fb.com", "www.fb.com"}
_FB_REDIRECT_HOSTS = {"l.facebook.com", "lm.facebook.com", "l.messenger.com"}
_IG_REDIRECT_HOSTS = {"l.instagram.com"}

_SHORTENERS = {"fb.watch", "fb.me", "vm.tiktok.com", "vt.tiktok.com", "t.co", "bit.ly", "tinyurl.com", "ow.ly",
               "buff.ly", "rebrand.ly", "is.gd", "shorturl.at", "cutt.ly", "s.net.vn", "goo.gl", "lnkd.in", "t.ly",
               "zalo.me"}

_DOC_EXT = re.compile(r"\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv)$", re.IGNORECASE)


@dataclass(frozen=True)
class Classified:
    platform: str  # facebook | threads | instagram | tiktok | youtube | x | web | document
    kind: str      # post | video | photo | story | profile | page | article | document


def extract_url(text: str) -> str | None:
    """The first http(s) URL in `text` (a bare URL or a share-sheet blob)."""
    if not text:
        return None
    m = _URL_RE.search(text)
    if not m:
        return None
    url = m.group(0)
    while url and url[-1] in _TRAILING_PUNCT:
        # keep a closing paren that is part of the URL, e.g. wiki links "Foo_(bar)"
        if url[-1] == ")" and url.count("(") >= url.count(")"):
            break
        url = url[:-1]
    return url or None


def _platform_of_host(host: str) -> str | None:
    if host in _FB_HOSTS or host.endswith(".facebook.com") or host == "fb.watch":
        return "facebook"
    if host.endswith("threads.com") or host.endswith("threads.net"):
        return "threads"
    if host in ("instagram.com", "www.instagram.com", "instagr.am", "m.instagram.com"):
        return "instagram"
    if host.endswith("tiktok.com"):
        return "tiktok"
    if host in ("youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"):
        return "youtube"
    if host in ("x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com", "mobile.x.com"):
        return "x"
    return None


def _unwrap(url: str) -> str:
    """Undo redirect wrappers that carry the real target in a query parameter."""
    for _ in range(3):
        p = urlsplit(url)
        host = (p.hostname or "").lower()
        q = dict(parse_qsl(p.query, keep_blank_values=True))
        if host in _FB_REDIRECT_HOSTS or host in _IG_REDIRECT_HOSTS or (
                host in _FB_HOSTS and p.path.rstrip("/") == "/l.php"):
            target = q.get("u")
        elif host in _FB_HOSTS and p.path.startswith("/login") and q.get("next"):
            target = q.get("next")
        elif host.endswith("google.com") and p.path == "/url":
            target = q.get("q") or q.get("url")
        else:
            return url
        if not target or not target.lower().startswith(("http://", "https://")):
            return url
        url = unquote(target) if "%3A" in target[:12].upper() else target
    return url


def canonicalize(url: str) -> str:
    """Normalise `url` into the dedupe key. Offline and deterministic."""
    url = _unwrap(url.strip())
    p = urlsplit(url)
    scheme = "https" if p.scheme.lower() in ("http", "https") else p.scheme.lower()
    host = (p.hostname or "").lower().rstrip(".")
    port = f":{p.port}" if p.port and p.port not in (80, 443) else ""
    path = re.sub(r"/{2,}", "/", p.path or "/")
    platform = _platform_of_host(host)
    params = parse_qsl(p.query, keep_blank_values=True)

    if platform == "facebook" and host != "fb.watch":
        host = "www.facebook.com"
    elif platform == "threads" and not _is_threads_share(path):
        host = "www.threads.com"
    elif platform == "instagram":
        host = "www.instagram.com"
        path = re.sub(r"^/reels/", "/reel/", path)
        # /<user>/p/<code>/ and /<user>/reel/<code>/ -> /p/<code>, /reel/<code>
        path = re.sub(r"^/[^/]+/(p|reel|tv)/([^/]+)", r"/\1/\2", path)
    elif platform == "x":
        host = "x.com"
    elif platform == "tiktok" and host not in ("vm.tiktok.com", "vt.tiktok.com"):
        host = "www.tiktok.com"
    elif platform == "youtube":
        vid = None
        if host == "youtu.be":
            vid = path.strip("/").split("/")[0] or None
        elif path.startswith(("/shorts/", "/live/", "/embed/")):
            vid = path.split("/")[2] or None
        elif path == "/watch":
            vid = dict(params).get("v")
        host = "www.youtube.com"
        if vid:
            return f"https://www.youtube.com/watch?v={quote(vid, safe='-_')}"
    elif host.startswith("www.") and platform is None:
        pass  # keep "www." on ordinary sites: some serve different content without it

    if platform in _KEEP:
        keep = _KEEP[platform]
        params = [(k, v) for k, v in params if k in keep]
    else:
        params = [(k, v) for k, v in params
                  if k.lower() not in _TRACKING and not k.lower().startswith(_TRACKING_PREFIXES)]

    if len(path) > 1:
        path = path.rstrip("/")
    query = urlencode(params, doseq=True)
    return urlunsplit((scheme, host + port, path, query, ""))  # fragment dropped


def _is_threads_share(path: str) -> bool:
    return path.startswith("/share/")


def needs_resolution(url: str) -> bool:
    """True if the canonical URL is a share link/shortener whose target needs a network round trip."""
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    path = p.path or "/"
    if host in _SHORTENERS:
        return True
    if host == "www.facebook.com" and path.startswith("/share/"):
        return True
    if _platform_of_host(host) == "threads" and _is_threads_share(path):
        return True
    return False


def classify(url: str) -> Classified:
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    path = p.path or "/"
    q = dict(parse_qsl(p.query))
    platform = _platform_of_host(host)

    if platform == "facebook":
        if host == "fb.watch" or re.search(r"^/(reel|watch)\b|/videos/|^/share/[rv]/", path) or path == "/video.php":
            return Classified("facebook", "video")
        if path.startswith("/stories/"):
            return Classified("facebook", "story")
        if re.search(r"^/photo(\.php)?/?$|/photos/", path):
            return Classified("facebook", "photo")
        if re.search(r"/posts/|/permalink/|^/permalink\.php|^/story\.php|^/share/p/|^/groups/[^/]+/(posts|permalink)/",
                     path) or "story_fbid" in q:
            return Classified("facebook", "post")
        return Classified("facebook", "page")
    if platform == "threads":
        if "/post/" in path or _is_threads_share(path):
            return Classified("threads", "post")
        return Classified("threads", "profile")
    if platform == "instagram":
        if re.match(r"^/(reel|tv)/", path):
            return Classified("instagram", "video")
        if path.startswith("/p/"):
            return Classified("instagram", "post")
        if path.startswith("/stories/"):
            return Classified("instagram", "story")
        return Classified("instagram", "profile")
    if platform == "tiktok":
        if "/video/" in path or host in ("vm.tiktok.com", "vt.tiktok.com"):
            return Classified("tiktok", "video")
        if "/photo/" in path:
            return Classified("tiktok", "post")
        return Classified("tiktok", "profile")
    if platform == "youtube":
        if path == "/watch" or path.startswith(("/shorts/", "/live/")) or host == "youtu.be":
            return Classified("youtube", "video")
        return Classified("youtube", "page")
    if platform == "x":
        return Classified("x", "post" if "/status/" in path else "profile")
    if _DOC_EXT.search(path):
        return Classified("document", "document")
    return Classified("web", "article" if path not in ("", "/") else "page")


def is_login_url(url: str) -> bool:
    p = urlsplit(url)
    host = (p.hostname or "").lower()
    path = p.path or ""
    return bool(
        re.match(r"^/(login|accounts/login|checkpoint|i/flow/login|signin)", path)
        or (host.endswith("google.com") and path.startswith("/ServiceLogin"))
        or (host == "consent.youtube.com" or host == "consent.google.com")
    )

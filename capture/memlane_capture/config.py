"""Settings, all from environment variables (see capture/.env.example)."""

import os
from dataclasses import dataclass, field


def _bool(name: str, default: bool = False) -> bool:
    v = os.environ.get(name)
    return default if v is None else v.strip().lower() in ("1", "true", "yes", "on")


def _list(name: str) -> list[str]:
    return [s.strip() for s in os.environ.get(name, "").split(",") if s.strip()]


@dataclass(frozen=True)
class Settings:
    database_url: str = field(default_factory=lambda: os.environ.get("DATABASE_URL", ""))

    # storage: "local" (STORAGE_DIR) or "s3" (any S3-compatible: Backblaze B2, R2, MinIO)
    storage_backend: str = field(default_factory=lambda: os.environ.get("STORAGE_BACKEND", "local"))
    storage_dir: str = field(default_factory=lambda: os.environ.get("STORAGE_DIR", "/data/store"))
    s3_bucket: str = field(default_factory=lambda: os.environ.get("S3_BUCKET", ""))
    s3_endpoint: str = field(default_factory=lambda: os.environ.get("S3_ENDPOINT", ""))
    s3_region: str = field(default_factory=lambda: os.environ.get("S3_REGION", ""))
    s3_access_key: str = field(default_factory=lambda: os.environ.get("S3_ACCESS_KEY", ""))
    s3_secret_key: str = field(default_factory=lambda: os.environ.get("S3_SECRET_KEY", ""))
    s3_prefix: str = field(default_factory=lambda: os.environ.get("S3_PREFIX", "capture/"))

    # capture
    work_dir: str = field(default_factory=lambda: os.environ.get("WORK_DIR", "/tmp/memlane-capture"))
    worker_concurrency: int = field(default_factory=lambda: int(os.environ.get("WORKER_CONCURRENCY", "2")))
    poll_seconds: float = field(default_factory=lambda: float(os.environ.get("POLL_SECONDS", "3")))
    stuck_after_minutes: int = field(default_factory=lambda: int(os.environ.get("STUCK_AFTER_MINUTES", "30")))
    media_max_mb: int = field(default_factory=lambda: int(os.environ.get("MEDIA_MAX_MB", "750")))
    # A replayable archive (WACZ) of the view witness's own visit (wacz.py): no second visit, only storage.
    wacz: bool = field(default_factory=lambda: os.environ.get("CAPTURE_WACZ", "1") == "1")
    # Social posts only by default: recording adds no time there (measured on Facebook, 2026-10-21), but on a
    # heavy news homepage it doubled the time and the full-page screenshot timed out. YouTube streams video into
    # the page (the media witness has the file anyway).
    wacz_platforms: str = field(default_factory=lambda: os.environ.get(
        "CAPTURE_WACZ_PLATFORMS", "facebook,instagram,threads,x,tiktok"))
    wacz_max_mb: int = field(default_factory=lambda: int(os.environ.get("CAPTURE_WACZ_MAX_MB", "150")))
    # Where people open a WACZ: the replay viewer on its own origin (replay.py). Empty: no "interactive copy" link.
    replay_url: str = field(default_factory=lambda: os.environ.get("REPLAY_URL", "").rstrip("/"))
    # How the replay viewer reaches the hub's artifact endpoint, server to server.
    hub_internal_url: str = field(default_factory=lambda: os.environ.get("HUB_INTERNAL_URL", "http://api:8700").rstrip("/"))
    media_timeout_s: int = field(default_factory=lambda: int(os.environ.get("MEDIA_TIMEOUT_S", "900")))
    view_timeout_s: int = field(default_factory=lambda: int(os.environ.get("VIEW_TIMEOUT_S", "120")))
    # Optional residential/VN egress (proposal §6.4; egress.py). May contain {port} (a random port in
    # CAPTURE_PROXY_PORTS per capture: DataImpulse sticky ports) or {session}. Holds credentials: never log it.
    http_proxy: str = field(default_factory=lambda: os.environ.get("CAPTURE_PROXY", ""))
    proxy_ports: str = field(default_factory=lambda: os.environ.get("CAPTURE_PROXY_PORTS", "10000-20000"))
    # Only these platforms go through the proxy (empty: all). Facebook and the web still work from the server.
    proxy_platforms: str = field(default_factory=lambda: os.environ.get("CAPTURE_PROXY_PLATFORMS", "threads,instagram"))
    # In the browser, these hosts go direct: Meta's file servers (scripts, images), most of the billed bytes.
    proxy_bypass: str = field(default_factory=lambda: os.environ.get(
        "CAPTURE_PROXY_BYPASS", ".cdninstagram.com,.fbcdn.net"))
    # Chromium with a real (virtual) display instead of headless: fewer automation tells. The worker starts Xvfb.
    headful: bool = field(default_factory=lambda: os.environ.get("CAPTURE_HEADFUL", "1") == "1")
    # Netscape cookies.txt for yt-dlp, per platform: COOKIES_FACEBOOK=/secrets/fb.txt etc.
    # Only ever from throwaway accounts (archivebox/THROWAWAY-ACCOUNTS.md).
    # What the browser really is (Chromium on Linux, the version Playwright pins: keep in step when bumping).
    # A Windows user agent on a Linux browser is a known bot tell. Headful, the browser sends its own; this is
    # for link resolution and yt-dlp, and for headless runs. CAPTURE_USER_AGENT overrides it everywhere.
    user_agent_override: str = field(default_factory=lambda: os.environ.get("CAPTURE_USER_AGENT", ""))
    user_agent: str = field(default_factory=lambda: os.environ.get(
        "CAPTURE_USER_AGENT",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36"))
    locale: str = field(default_factory=lambda: os.environ.get("CAPTURE_LOCALE", "vi-VN"))
    timezone: str = field(default_factory=lambda: os.environ.get("CAPTURE_TIMEZONE", "Asia/Ho_Chi_Minh"))

    # Internet Archive SPN2 (optional): never counted as "the" capture, see gate.py
    ia_access_key: str = field(default_factory=lambda: os.environ.get("IA_ACCESS_KEY", ""))
    ia_secret_key: str = field(default_factory=lambda: os.environ.get("IA_SECRET_KEY", ""))
    # Unfiled inbox items are not sent unless this is on; filed items follow their project's setting.
    wayback_default_unfiled: bool = field(default_factory=lambda: _bool("WAYBACK_DEFAULT_UNFILED", False))
    spn_base: str = field(default_factory=lambda: os.environ.get("SPN_BASE", "https://web.archive.org"))

    # Map tiles for the map view. Every tile request tells the tile server which area is being looked
    # at; point this at a self-hosted or trusted tile server for sensitive investigations.
    # Default: CARTO Voyager, the public MemoryLane map's style. OpenStreetMap's own tile servers refuse apps
    # that don't meet their tile usage policy (HTTP 403 "Access blocked", seen 2026-10-18). A CARTO key, if
    # any, goes in the URL: TILE_URL=https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=...
    tile_url: str = field(default_factory=lambda: os.environ.get(
        "TILE_URL", "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"))
    tile_subdomains: str = field(default_factory=lambda: os.environ.get("TILE_SUBDOMAINS", "abcd"))
    tile_attribution: str = field(default_factory=lambda: os.environ.get(
        "TILE_ATTRIBUTION", "© OpenStreetMap contributors · © CARTO"))

    # Community intake (intake.py): per-source keys are derived from this secret, so the DB holds none.
    # Without it the Intake API answers 503.
    intake_key_secret: str = field(default_factory=lambda: os.environ.get("INTAKE_KEY_SECRET", ""))
    # X25519 private key (base64) that opens contact details sealed by the public sites (libsodium sealed box).
    contact_secret_key: str = field(default_factory=lambda: os.environ.get("CONTACT_SECRET_KEY", ""))
    intake_max_video_mb: int = field(default_factory=lambda: int(os.environ.get("INTAKE_MAX_VIDEO_MB", "60")))
    intake_max_file_mb: int = field(default_factory=lambda: int(os.environ.get("INTAKE_MAX_FILE_MB", "20")))

    # Publication feed (feed.py): written to a local directory or an S3-compatible bucket (B2), served publicly.
    feed_store: str = field(default_factory=lambda: os.environ.get("FEED_STORE", "local"))
    feed_dir: str = field(default_factory=lambda: os.environ.get("FEED_DIR", "/data/feed"))
    feed_s3_bucket: str = field(default_factory=lambda: os.environ.get("FEED_S3_BUCKET", ""))
    feed_s3_endpoint: str = field(default_factory=lambda: os.environ.get("FEED_S3_ENDPOINT", ""))
    feed_s3_region: str = field(default_factory=lambda: os.environ.get("FEED_S3_REGION", ""))
    feed_s3_access_key: str = field(default_factory=lambda: os.environ.get("FEED_S3_ACCESS_KEY", ""))
    feed_s3_secret_key: str = field(default_factory=lambda: os.environ.get("FEED_S3_SECRET_KEY", ""))
    feed_s3_prefix: str = field(default_factory=lambda: os.environ.get("FEED_S3_PREFIX", ""))
    # Where readers fetch it, e.g. https://feed.example.org (shown in the UI; records use relative paths).
    feed_public_url: str = field(default_factory=lambda: os.environ.get("FEED_PUBLIC_URL", ""))
    # Online signing key (file or base64), the root's delegation for it, and any revocations (feedkeys.py).
    feed_online_key: str = field(default_factory=lambda: os.environ.get("FEED_ONLINE_KEY", ""))
    feed_delegation: str = field(default_factory=lambda: os.environ.get("FEED_DELEGATION", ""))
    feed_revocations: str = field(default_factory=lambda: os.environ.get("FEED_REVOCATIONS", ""))
    # Local development only: serve FEED_DIR at /feed/ from the API.
    feed_serve_local: bool = field(default_factory=lambda: _bool("FEED_SERVE_LOCAL", False))
    # Optional URLs told "the feed changed" after each build (a nudge only: readers still verify the feed).
    feed_webhooks: list[str] = field(default_factory=lambda: _list("FEED_WEBHOOKS"))

    # API
    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS"))
    submit_rate_per_hour: int = field(default_factory=lambda: int(os.environ.get("SUBMIT_RATE_PER_HOUR", "120")))

    def cookies_for(self, platform: str) -> str | None:
        path = os.environ.get(f"COOKIES_{platform.upper()}")
        return path if path and os.path.isfile(path) else None


settings = Settings()

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
    media_timeout_s: int = field(default_factory=lambda: int(os.environ.get("MEDIA_TIMEOUT_S", "900")))
    view_timeout_s: int = field(default_factory=lambda: int(os.environ.get("VIEW_TIMEOUT_S", "120")))
    # Optional proxy for all outbound capture traffic, e.g. a residential/VN egress (proposal §6.4).
    http_proxy: str = field(default_factory=lambda: os.environ.get("CAPTURE_PROXY", ""))
    # Netscape cookies.txt for yt-dlp, per platform: COOKIES_FACEBOOK=/secrets/fb.txt etc.
    # Only ever from throwaway accounts (archivebox/THROWAWAY-ACCOUNTS.md).
    user_agent: str = field(default_factory=lambda: os.environ.get(
        "CAPTURE_USER_AGENT",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/141.0.0.0 Safari/537.36"))
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

    # API
    cors_origins: list[str] = field(default_factory=lambda: _list("CORS_ORIGINS"))
    submit_rate_per_hour: int = field(default_factory=lambda: int(os.environ.get("SUBMIT_RATE_PER_HOUR", "120")))

    def cookies_for(self, platform: str) -> str | None:
        path = os.environ.get(f"COOKIES_{platform.upper()}")
        return path if path and os.path.isfile(path) else None


settings = Settings()

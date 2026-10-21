"""Which way a capture goes out: direct from this server, or through the residential proxy (CAPTURE_PROXY).

One capture is one visitor: it gets one IP for all its requests (a sticky session; with DataImpulse, a random
port in CAPTURE_PROXY_PORTS, each port holding one IP for a while), and the next capture gets another. Only the
platforms that refuse this server go through the proxy (CAPTURE_PROXY_PLATFORMS), and in the browser Meta's file
servers (scripts, images) go direct (CAPTURE_PROXY_BYPASS): the pages and their data are what the platform rate-
limits, and the files are most of the bytes a residential proxy bills (measured 2026-10-21: 94% of a Threads save).

The proxy URL carries credentials: it is never logged, stored with a capture, or returned by the API. A capture
records only "proxy" or "direct".
"""

import random
import secrets
from dataclasses import dataclass
from urllib.parse import unquote, urlsplit

from .config import settings


@dataclass(frozen=True)
class Egress:
    url: str | None = None          # full proxy URL for this capture, or None: direct

    @property
    def label(self) -> str:
        return "proxy" if self.url else "direct"

    def playwright(self) -> dict | None:
        """Chromium takes the credentials apart from the server."""
        if not self.url:
            return None
        u = urlsplit(self.url)
        out = {"server": f"{u.scheme}://{u.hostname}:{u.port}"}
        if u.username:
            out["username"] = unquote(u.username)
            out["password"] = unquote(u.password or "")
        if settings.proxy_bypass:
            out["bypass"] = settings.proxy_bypass
        return out


def for_capture(platform: str) -> Egress:
    template = settings.http_proxy
    if not template:
        return Egress()
    wanted = [p.strip() for p in settings.proxy_platforms.split(",") if p.strip()]
    if wanted and platform not in wanted:
        return Egress()
    url = template
    if "{port}" in url:
        lo, _, hi = settings.proxy_ports.partition("-")
        url = url.replace("{port}", str(random.randint(int(lo), int(hi or lo))))
    if "{session}" in url:
        url = url.replace("{session}", secrets.token_hex(6))
    return Egress(url)

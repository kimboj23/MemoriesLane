"""Follow share links and shorteners (facebook.com/share/..., threads.com/share/...,
fb.watch, vm.tiktok.com, t.co...) to the content they point at.

A plain HTTP redirect chain is enough for most of them. When the chain ends
on a login page, the target is usually still in its `next=` parameter
(urls.canonicalize unwraps that). If nothing useful comes back, the view
witness's real browser gets another chance and its final URL is used.
"""

import httpx

from .config import settings
from .urls import canonicalize, is_login_url


async def resolve(url: str, proxy: str | None = None) -> str | None:
    """Canonical URL the link leads to, or None if it could not be resolved."""
    headers = {"User-Agent": settings.user_agent, "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8"}
    try:
        async with httpx.AsyncClient(follow_redirects=True, max_redirects=10, timeout=20,
                                     headers=headers, proxy=proxy) as client:
            r = await client.get(url)
            chain = [str(h.url) for h in r.history] + [str(r.url)]
    except httpx.HTTPError:
        return None
    # Prefer the last hop that is real content, not a login/consent page.
    for hop in reversed(chain):
        if not hop.startswith("http"):
            continue
        canon = canonicalize(hop)
        if not is_login_url(canon) and canon != canonicalize(url):
            return canon
    return None

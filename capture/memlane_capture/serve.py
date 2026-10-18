"""Serving stored files (capture artifacts, community uploads): always sandboxed, with byte ranges for media."""

import re

from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse

from .storage import get_storage, iter_chunks

# Stored files are hostile content. Every response is sandboxed (opaque origin, no scripts), and may not
# fetch anything: captured HTML renders from its own markup only, so opening it never pings the
# platform or a tracker. The UI additionally embeds HTML in <iframe sandbox>.
SANDBOX_CSP = ("sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; "
               "font-src data:")

_RANGE = re.compile(r"bytes=(\d*)-(\d*)$")


def stored_response(request: Request, *, storage_key: str, size: int | None, mime: str | None,
                    sha256: str | None) -> StreamingResponse:
    size = size or get_storage().size(storage_key)
    headers = {"X-Content-SHA256": sha256 or "", "Cache-Control": "private, max-age=21600",
               "Content-Security-Policy": SANDBOX_CSP, "X-Content-Type-Options": "nosniff",
               "Cross-Origin-Resource-Policy": "same-origin", "Accept-Ranges": "bytes",
               "Content-Disposition": "inline"}
    mime = mime or "application/octet-stream"
    if mime.startswith("text/") and "charset" not in mime:
        mime += "; charset=utf-8"
    m = _RANGE.match(request.headers.get("range", ""))
    if m and (m.group(1) or m.group(2)):
        # Single byte range, so <video> can seek and start without downloading the whole file.
        if m.group(1):
            start, end = int(m.group(1)), min(int(m.group(2) or size - 1), size - 1)
        else:
            start, end = max(0, size - int(m.group(2))), size - 1
        if start > end or start >= size:
            raise HTTPException(416, headers={"Content-Range": f"bytes */{size}"})
        headers.update({"Content-Range": f"bytes {start}-{end}/{size}", "Content-Length": str(end - start + 1)})
        f = get_storage().open(storage_key, start, end)
        return StreamingResponse(iter_chunks(f, end - start + 1), status_code=206, media_type=mime, headers=headers)
    headers["Content-Length"] = str(size)
    return StreamingResponse(iter_chunks(get_storage().open(storage_key)), media_type=mime, headers=headers)

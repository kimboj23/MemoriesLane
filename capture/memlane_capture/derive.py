"""File type sniffing for community uploads, and cleaned public copies of media for the feed.

Uploads are checked by their bytes, never by the declared type or name. Public copies are re-encoded (images)
or remuxed (video/audio) with all metadata dropped: EXIF/GPS, camera serials, encoder tags, titles, chapters.
The original stays internal and sealed; the feed publishes both hashes so anyone can match the copy to the
archive's record.
"""

import os
import subprocess
import tempfile

SNIFF_LIMIT = 64


def sniff(head: bytes) -> tuple[str, str] | None:
    """(kind, mime) from a file's first bytes, or None if it isn't an accepted type."""
    if head.startswith(b"\xff\xd8\xff"):
        return "image", "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image", "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image", "image/webp"
    if head[:6] in (b"GIF87a", b"GIF89a"):
        return "image", "image/gif"
    if head[4:8] == b"ftyp":
        return "video", "video/mp4"
    if head.startswith(b"\x1a\x45\xdf\xa3"):
        return "video", "video/webm"
    if head.startswith(b"%PDF-"):
        return "pdf", "application/pdf"
    return None


def looks_like_text(path: str, limit: int = 2_000_000) -> bool:
    """UTF-8 text without NULs (for .txt uploads, which have no magic bytes)."""
    with open(path, "rb") as f:
        data = f.read(limit)
    if b"\x00" in data:
        return False
    try:
        data.decode("utf-8")
    except UnicodeDecodeError as e:
        return e.start > len(data) - 4      # a multi-byte character cut at the read limit
    return True


EXT = {"image/webp": ".webp", "video/mp4": ".mp4", "video/webm": ".webm", "audio/mp4": ".m4a",
       "audio/mpeg": ".mp3", "audio/webm": ".weba"}


def public_copy(src: str, mime: str, out_dir: str) -> tuple[str, str, str]:
    """Make a metadata-free copy of `src`. Returns (path, mime, kind). Raises ValueError if not publishable."""
    major = (mime or "").split("/")[0]
    if major == "image":
        return _image(src, out_dir), "image/webp", "image"
    if major in ("video", "audio"):
        ext = ".webm" if "webm" in mime else (".mp4" if major == "video" else os.path.splitext(src)[1] or ".m4a")
        out = os.path.join(out_dir, "public" + ext)
        # -c copy keeps the streams bit for bit; -map_metadata/-map_chapters -1 drop every tag and chapter.
        r = subprocess.run(["ffmpeg", "-nostdin", "-loglevel", "error", "-y", "-i", src, "-map", "0:v?", "-map",
                            "0:a?", "-map_metadata", "-1", "-map_chapters", "-1", "-c", "copy",
                            *(["-movflags", "+faststart"] if ext == ".mp4" else []), out],
                           capture_output=True, timeout=600)
        if r.returncode or not os.path.isfile(out):
            raise ValueError("ffmpeg could not remux this file: " + r.stderr.decode(errors="replace")[-300:])
        out_mime = ("video/" if major == "video" else "audio/") + ("webm" if ext == ".webm" else "mp4")
        return out, out_mime, major
    raise ValueError(f"{mime} files are not published (only images, video and audio)")


def _image(src: str, out_dir: str) -> str:
    from PIL import Image, ImageOps

    Image.MAX_IMAGE_PIXELS = 120_000_000   # full-page screenshots are tall; anything bigger is refused
    with Image.open(src) as im:
        im = ImageOps.exif_transpose(im)   # keep the orientation the EXIF asked for, then drop the EXIF
        if getattr(im, "n_frames", 1) > 1:
            im.seek(0)                     # animated GIF/WebP: first frame only
        im = im.convert("RGBA" if im.mode in ("RGBA", "LA", "P") else "RGB")
        clean = Image.new(im.mode, im.size)
        clean.paste(im)                    # a fresh image: no info/ICC/XMP carried over
        out = os.path.join(out_dir, "public.webp")
        clean.save(out, "WEBP", quality=85, method=4)
    return out


def workdir() -> tempfile.TemporaryDirectory:
    return tempfile.TemporaryDirectory(prefix="memlane-public-")

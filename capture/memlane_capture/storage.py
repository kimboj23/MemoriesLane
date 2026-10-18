"""Content-addressed artifact storage: the key is derived from the file's SHA-256,
so identical bytes are stored once and a key always names exactly one content.

  sha256/ab/cd/abcd1234....<ext>
"""

import hashlib
import mimetypes
import os
import pathlib
import shutil
from typing import BinaryIO, Iterator

from .config import settings

CHUNK = 1024 * 1024


def sha256_file(path: str) -> tuple[str, int]:
    h = hashlib.sha256()
    n = 0
    with open(path, "rb") as f:
        while chunk := f.read(CHUNK):
            h.update(chunk)
            n += len(chunk)
    return h.hexdigest(), n


def key_for(sha256: str, ext: str) -> str:
    ext = ext if ext.startswith(".") or not ext else "." + ext
    return f"sha256/{sha256[:2]}/{sha256[2:4]}/{sha256}{ext.lower()}"


def guess_mime(path: str) -> str:
    mime, _ = mimetypes.guess_type(path)
    return mime or "application/octet-stream"


class LocalStorage:
    def __init__(self, root: str):
        self.root = pathlib.Path(root)

    def put(self, path: str, key: str, mime: str) -> None:
        dest = self.root / key
        if dest.exists():
            return
        dest.parent.mkdir(parents=True, exist_ok=True)
        tmp = dest.with_suffix(dest.suffix + ".part")
        shutil.copyfile(path, tmp)
        os.replace(tmp, dest)

    def open(self, key: str, start: int | None = None, end: int | None = None) -> BinaryIO:
        f = open(self.root / key, "rb")
        if start:
            f.seek(start)
        return f

    def size(self, key: str) -> int:
        return (self.root / key).stat().st_size


class S3Storage:
    def __init__(self):
        import boto3  # only needed for this backend
        self.bucket = settings.s3_bucket
        self.prefix = settings.s3_prefix
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint or None,
            region_name=settings.s3_region or None,
            aws_access_key_id=settings.s3_access_key or None,
            aws_secret_access_key=settings.s3_secret_key or None,
        )

    def put(self, path: str, key: str, mime: str) -> None:
        full = self.prefix + key
        try:
            self.client.head_object(Bucket=self.bucket, Key=full)
            return  # same content already stored
        except Exception:
            pass
        self.client.upload_file(path, self.bucket, full, ExtraArgs={"ContentType": mime})

    def open(self, key: str, start: int | None = None, end: int | None = None) -> BinaryIO:
        extra = {"Range": f"bytes={start or 0}-{'' if end is None else end}"} if start is not None else {}
        return self.client.get_object(Bucket=self.bucket, Key=self.prefix + key, **extra)["Body"]

    def size(self, key: str) -> int:
        return self.client.head_object(Bucket=self.bucket, Key=self.prefix + key)["ContentLength"]


def iter_chunks(f: BinaryIO, limit: int | None = None) -> Iterator[bytes]:
    """Stream a file in chunks, stopping after `limit` bytes if given (for range requests)."""
    remaining = limit
    try:
        while remaining is None or remaining > 0:
            chunk = f.read(CHUNK if remaining is None else min(CHUNK, remaining))
            if not chunk:
                break
            if remaining is not None:
                remaining -= len(chunk)
            yield chunk
    finally:
        f.close()


_storage = None


def get_storage():
    global _storage
    if _storage is None:
        _storage = S3Storage() if settings.storage_backend == "s3" else LocalStorage(settings.storage_dir)
    return _storage

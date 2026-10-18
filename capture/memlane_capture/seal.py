"""Seal a capture: hash every artifact, store it content-addressed, and write a
manifest that lists them all. The manifest is stored and hashed too, so one
hash (captures.manifest_sha256) pins the entire capture.

Unlike the old platform, which hashed ArchiveBox's regenerated index.html or a
thumbnail (proposal F8), every file is hashed, the media included.
"""

import json
import os
from datetime import datetime, timezone
from typing import Any

from . import __version__
from .models import ArtifactDraft, Verdict, WitnessResult
from .storage import get_storage, guess_mime, key_for, sha256_file

MANIFEST_SCHEMA = "memlane-capture-manifest/1"


def public_extracted(extracted: dict) -> dict:
    """Drop gate-only fields (underscore keys) before anything is persisted."""
    return {k: v for k, v in extracted.items() if not k.startswith("_")}


def _store(draft: ArtifactDraft) -> dict[str, Any]:
    row: dict[str, Any] = {
        "kind": draft.kind, "role": draft.role, "label": draft.label, "source_url": draft.source_url,
        "width": draft.width, "height": draft.height, "duration_s": draft.duration_s, "meta": draft.meta,
        "sha256": None, "bytes": None, "mime": draft.mime, "storage_key": None,
    }
    if draft.path:
        sha, size = sha256_file(draft.path)
        mime = draft.mime or guess_mime(draft.path)
        key = key_for(sha, os.path.splitext(draft.path)[1])
        get_storage().put(draft.path, key, mime.split(";")[0])
        row.update(sha256=sha, bytes=size, mime=mime, storage_key=key)
    return row


def seal(*, work_dir: str, item: dict, capture: dict, results: dict[str, WitnessResult], verdict: Verdict,
         final_url: str | None, resolved_url: str | None, started_at: datetime) -> dict[str, Any]:
    """Store every artifact and the manifest. Returns rows and manifest info for the DB."""
    rows = []
    for name, res in results.items():
        for draft in res.artifacts:
            if draft.path and not os.path.isfile(draft.path):
                continue
            row = _store(draft)
            row["witness"] = name
            rows.append(row)

    finished_at = datetime.now(timezone.utc)
    manifest = {
        "schema": MANIFEST_SCHEMA,
        "generator": f"memlane-capture {__version__}",
        "item": {
            "id": str(item["id"]), "submitted_url": item["submitted_url"], "canonical_url": item["canonical_url"],
            "resolved_url": resolved_url, "platform": item["platform"], "kind": item["kind"],
        },
        "capture": {
            "id": str(capture["id"]), "started_at": started_at.isoformat(), "finished_at": finished_at.isoformat(),
            "final_url": final_url, "verdict": verdict.verdict, "reasons": verdict.reasons,
            "egress": capture.get("egress", "direct"), "session": capture.get("session", "none"),
        },
        "witnesses": [r.summary() for r in results.values()],
        "extracted": public_extracted(verdict.extracted),
        "artifacts": [
            {k: r[k] for k in ("witness", "kind", "role", "label", "sha256", "bytes", "mime", "source_url",
                               "storage_key", "duration_s")}
            for r in rows
        ],
    }
    path = os.path.join(work_dir, "manifest.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2, sort_keys=True, default=str)
    m_row = _store(ArtifactDraft("manifest", "context", "manifest", path, mime="application/json"))
    m_row["witness"] = "seal"
    rows.append(m_row)
    return {"artifacts": rows, "manifest_key": m_row["storage_key"], "manifest_sha256": m_row["sha256"],
            "finished_at": finished_at}

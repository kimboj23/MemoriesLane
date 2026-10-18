"""Plain data passed between witnesses, the gate and the sealer."""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ArtifactDraft:
    """A file (or, for kind='link', just a URL) a witness produced, before it is hashed and stored."""
    kind: str                    # video | audio | image | screenshot | html | text | metadata | pdf | wacz | link
    role: str                    # primary (the content itself) | context (how it was served, thumbnails, ...)
    label: str
    path: str | None = None      # local file; None for kind='link'
    mime: str | None = None
    source_url: str | None = None
    width: int | None = None
    height: int | None = None
    duration_s: float | None = None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class WitnessResult:
    """What one independent capture method saw.

    `signals` are facts for the gate (e.g. wall phrases seen, HTTP status,
    login redirect); `extracted` is content (author, text, published_at...).
    """
    name: str
    ok: bool = False
    error: str | None = None
    final_url: str | None = None
    artifacts: list[ArtifactDraft] = field(default_factory=list)
    signals: dict[str, Any] = field(default_factory=dict)
    extracted: dict[str, Any] = field(default_factory=dict)
    tool_version: str | None = None
    seconds: float = 0.0

    def summary(self) -> dict[str, Any]:
        return {
            "name": self.name, "ok": self.ok, "error": self.error, "final_url": self.final_url,
            "artifacts": len(self.artifacts), "signals": self.signals, "tool_version": self.tool_version,
            "seconds": round(self.seconds, 1),
        }


@dataclass
class Verdict:
    verdict: str                 # complete | partial | walled | unavailable | failed
    reasons: list[str]
    extracted: dict[str, Any]    # merged best-of content across witnesses

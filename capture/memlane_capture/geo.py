"""Public location and date precision (docs/integration-design.md §12, policy accepted 2026-10-18).

The exact location stays internal. A public version shows a point snapped to a fixed grid sized like the chosen
level, so republishing or publishing related records never reveals more (random offsets would average out to
the true spot). Coarse points carry a radius so maps draw an area ("khu vực ước lượng"), not a pin.

Grid cells approximate the units in §12.2 until a ward/province boundary dataset is added: `ward` cells are
~2.8 km (close to the merged post-2025 urban wards), `province` cells ~55 km.
"""

import math
from datetime import date

LEVELS = ["exact", "street", "ward", "province", "none"]          # finest first
RANK = {lvl: i for i, lvl in enumerate(LEVELS)}
GRID_DEG = {"street": 0.0025, "ward": 0.025, "province": 0.5}
RADIUS_M = {"exact": 0, "street": 250, "ward": 2000, "province": 40000}

# §12.4: the kind of place decides the default; "finer" lists levels below the default that the two
# approvers may choose with a recorded reason. Anything coarser than the default is always allowed.
PLACE_KINDS: dict[str, dict] = {
    "public_institution": {"default": "exact", "finer": []},
    "public_gathering": {"default": "street", "finer": ["exact"]},
    "private_city": {"default": "ward", "finer": []},
    "private_rural": {"default": "province", "finer": ["ward"]},
    # finer only if the submitter allowed an exact location and the place is public (checked by the reviewers)
    "memory": {"default": "ward", "finer": ["street", "exact"]},
    "legacy_memory": {"default": "exact", "finer": []},      # already public on the community map
    "online": {"default": "none", "finer": ["province"]},
}


class PolicyError(ValueError):
    """`code` (+ params) lets the UI say it in the user's language; str() is the English message."""

    def __init__(self, code: str, message: str, **params):
        super().__init__(message)
        self.code, self.params = code, params


def options(place_kind: str, submitter_max: str | None = None, submitter_allows_exact: bool = False) -> list[dict]:
    """The precision levels a reviewer may pick for this kind of place, finest first: [{level, needs_reason}].
    The UI offers only these, so a policy error can't happen by choosing from the menu."""
    rule = PLACE_KINDS.get(place_kind)
    if not rule:
        return []
    out = []
    for lvl in LEVELS:
        try:
            check(place_kind, lvl, "x", submitter_max, submitter_allows_exact)
        except PolicyError:
            continue
        out.append({"level": lvl, "needs_reason": RANK[lvl] < RANK[rule["default"]]})
    return out


def check(place_kind: str, precision: str, reason: str | None = None, submitter_max: str | None = None,
          submitter_allows_exact: bool = False) -> None:
    """Raise PolicyError if `precision` isn't allowed for this kind of place."""
    if place_kind not in PLACE_KINDS:
        raise PolicyError("unknown_kind", f"unknown place kind {place_kind!r}")
    if precision not in RANK:
        raise PolicyError("unknown_precision", f"unknown precision {precision!r}")
    # The submitter's choice is a ceiling: never finer than what they agreed to.
    if submitter_max and RANK[precision] < RANK[submitter_max]:
        raise PolicyError("submitter_ceiling", f"the submitter asked for no finer than {submitter_max}", max=submitter_max)
    rule = PLACE_KINDS[place_kind]
    if RANK[precision] >= RANK[rule["default"]]:
        return
    if precision not in rule["finer"]:
        raise PolicyError("not_allowed", f"{place_kind}: {precision} is finer than allowed (at most {rule['default']})", max=rule["default"])
    if place_kind == "memory" and not submitter_allows_exact:
        raise PolicyError("needs_consent", "memory: finer than ward only if the submitter allowed an exact location")
    if not (reason or "").strip():
        raise PolicyError("needs_reason", f"{place_kind}: {precision} is finer than the default {rule['default']}; give a reason", default=rule["default"])


def snap(lat: float | None, lng: float | None, precision: str) -> dict | None:
    """The public location, or None. Deterministic: the same input always gives the same output."""
    if lat is None or lng is None or precision == "none":
        return None
    if precision == "exact":
        return {"lat": round(lat, 5), "lng": round(lng, 5), "precision": "exact", "radius_m": 0}
    g = GRID_DEG[precision]
    return {"lat": round((math.floor(lat / g) + 0.5) * g, 5), "lng": round((math.floor(lng / g) + 0.5) * g, 5),
            "precision": precision, "radius_m": RADIUS_M[precision]}


def coarsen_date(value: str | date | None, precision: str = "day") -> dict | None:
    """{"value": "2026-03" , "precision": "month"} from an ISO date."""
    if not value:
        return None
    d = value if isinstance(value, date) else date.fromisoformat(str(value)[:10])
    if precision == "year":
        return {"value": f"{d.year:04d}", "precision": "year"}
    if precision == "month":
        return {"value": f"{d.year:04d}-{d.month:02d}", "precision": "month"}
    return {"value": d.isoformat(), "precision": "day"}

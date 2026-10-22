"""Admin health: how captures are going per platform (block rate), the scheduled canary, and alerts.

The verdicts already recorded per capture, added up per day and platform: a platform starting to block shows at a
glance. The canary (upkeep.py) checks known links on a schedule. /v1/admin/health is what the Admin link's warning
badge reads.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from .auth import Principal, require
from .config import settings
from .upkeep import PAID_MB_PER_LINK, load_canary, proxied_links

router = APIRouter(prefix="/v1/admin")

BLOCKED = ("walled", "failed", "rate_limited")


async def _stats(conn, days: int) -> dict:
    rows = await (await conn.execute(
        "SELECT (c.finished_at AT TIME ZONE 'UTC')::date AS day, i.platform,"
        "       CASE WHEN c.verdict = 'failed' AND c.verdict_reasons::text ILIKE '%%rate-limited%%' THEN 'rate_limited'"
        "            ELSE c.verdict END AS verdict, count(*) AS n"
        "  FROM capture.captures c JOIN capture.items i ON i.id = c.item_id"
        " WHERE c.state = 'done' AND c.finished_at > now() - make_interval(days => %s)"
        " GROUP BY 1, 2, 3", (days,))).fetchall()
    waiting = await (await conn.execute(
        "SELECT platform, count(*) AS n FROM capture.items WHERE status = 'rate_limited' GROUP BY 1")).fetchall()
    table: dict = defaultdict(lambda: defaultdict(lambda: defaultdict(int)))
    for r in rows:
        table[r["platform"]][r["day"].isoformat()][r["verdict"]] += r["n"]
    out = []
    for platform, by_day in sorted(table.items()):
        days_out = []
        for day, counts in sorted(by_day.items()):
            total = sum(counts.values())
            blocked = sum(counts.get(v, 0) for v in BLOCKED)
            days_out.append({"day": day, "total": total, "blocked": blocked, "counts": dict(counts)})
        out.append({"platform": platform, "days": days_out})
    return {"platforms": out, "waiting_rate_limited": {r["platform"]: r["n"] for r in waiting}}


async def _canary(conn) -> dict:
    runs = await (await conn.execute(
        "SELECT run_at, count(*) AS n, count(*) FILTER (WHERE ok) AS ok FROM capture.canary_runs"
        " GROUP BY run_at ORDER BY run_at DESC LIMIT 10")).fetchall()
    latest = []
    if runs:
        latest = [dict(r) for r in await (await conn.execute(
            "SELECT note, platform, expected, verdict, ok, reasons, egress, seconds FROM capture.canary_runs"
            " WHERE run_at = %s ORDER BY ok, platform, note", (runs[0]["run_at"],))).fetchall()]
    interval = settings.canary_interval_h
    next_run = (runs[0]["run_at"] + timedelta(hours=interval)) if runs and interval > 0 else None
    req = await (await conn.execute(
        "SELECT requested_at, started_at FROM capture.canary_requests WHERE finished_at IS NULL LIMIT 1")).fetchone()
    last_req = await (await conn.execute(
        "SELECT finished_at, error FROM capture.canary_requests WHERE finished_at IS NOT NULL"
        " ORDER BY finished_at DESC LIMIT 1")).fetchone()
    links = load_canary()
    paid = proxied_links(links)
    return {"links": len(links), "interval_h": interval, "next_run": next_run,
            "runs": [dict(r) for r in runs], "latest": latest, "request": dict(req) if req else None,
            "last_request_error": last_req["error"] if last_req else None,
            "proxied_links": paid, "est_paid_mb": round(paid * PAID_MB_PER_LINK, 1)}


@router.post("/canary/run", status_code=202)
async def run_canary_now(request: Request, p: Principal = Depends(require("admin"))):
    """Ask the worker to run the canary now (it holds the browser); one run at a time."""
    if not load_canary():
        raise HTTPException(409, "no canary links configured (CANARY_FILE)")
    async with request.app.state.pool.connection() as conn:
        try:
            await conn.execute("INSERT INTO capture.canary_requests (requested_by) VALUES (%s)", (p.contributor_id,))
        except psycopg.errors.UniqueViolation:
            raise HTTPException(409, "a canary run is already waiting or running") from None
        return await _canary(conn)


@router.get("/capture-stats")
async def capture_stats(request: Request, days: int = Query(14, ge=1, le=90), p: Principal = Depends(require("admin"))):
    async with request.app.state.pool.connection() as conn:
        return await _stats(conn, days)


@router.get("/canary")
async def canary(request: Request, p: Principal = Depends(require("admin"))):
    async with request.app.state.pool.connection() as conn:
        return await _canary(conn)


@router.get("/health")
async def health(request: Request, p: Principal = Depends(require("admin"))):
    """Alerts for the Admin badge: canary links worse than expected, and platforms mostly blocked today."""
    alerts = []
    async with request.app.state.pool.connection() as conn:
        c = await _canary(conn)
        for r in c["latest"]:
            if not r["ok"]:
                alerts.append({"kind": "canary", "platform": r["platform"], "note": r["note"], "expected": r["expected"],
                               "verdict": r["verdict"]})
        today = datetime.now(timezone.utc).date().isoformat()
        for pl in (await _stats(conn, 1))["platforms"]:
            d = next((x for x in pl["days"] if x["day"] == today), None)
            if d and d["total"] >= 3 and d["blocked"] * 2 >= d["total"]:
                alerts.append({"kind": "blocked", "platform": pl["platform"], "blocked": d["blocked"], "total": d["total"]})
    return {"alerts": alerts}

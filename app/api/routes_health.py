from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.config import get_settings
from app.crime.sources import LAYERS
from app.db import get_engine, get_sessionmaker
from app.services.crime_service import dashboard_freshness_by_layer

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    # Readiness probe: confirm the database is reachable, not just that the process is up,
    # so an orchestrator/healthcheck can tell "serving" from "running but DB is down".
    try:
        with get_engine().connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001 — any DB/connection failure means not-ready
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ok"}


SEATTLE_TZ = ZoneInfo("America/Los_Angeles")


def _local_today(now: datetime | None = None) -> date:
    """Today in Seattle. The SPD parsers stamp naive local wall-clock times as UTC, so a
    layer's data_through is a Seattle date — comparing it against the UTC date would add a
    spurious day of lag for the 7-8 hours after 17:00 local, which is enough to page on a
    dataset sitting exactly at the staleness threshold."""
    return (now or datetime.now(UTC)).astimezone(SEATTLE_TZ).date()


def _lag_days(data_through: object, today: date) -> int | None:
    """Days between a layer's newest incident date and today, or None when that date is
    missing or unparseable (which the caller treats as stale)."""
    if not isinstance(data_through, str):
        return None
    try:
        return (today - date.fromisoformat(data_through)).days
    except ValueError:
        return None


@router.get("/health/data", include_in_schema=False)
def health_data() -> JSONResponse:
    """Data-recency probe for an external uptime monitor — deliberately not the container
    healthcheck (that stays on /health): a dead ingest cron, a rejected admin token, or an
    upstream Socrata outage must page someone, not restart-loop the app.

    Hidden from the schema and session-free: it exposes only per-layer data_through/lag, which
    /dashboard/freshness already serves. Shares the dashboard's in-process freshness cache
    (same keys, same TTLs), so a poll recomputes the aggregate only when that cache has
    expired anyway. Unknown counts as stale.
    """
    threshold = get_settings().data_staleness_days
    today = _local_today()
    try:
        with get_sessionmaker()() as session:
            freshness = dashboard_freshness_by_layer(session)
    except Exception:  # noqa: BLE001 — unreadable freshness is stale, not healthy
        unknown = [
            {"layer": layer, "data_through": None, "lag_days": None} for layer in LAYERS
        ]
        return JSONResponse(status_code=503, content={"status": "unknown", "stale": unknown})

    stale: list[dict[str, object]] = []
    for layer, values in freshness.items():
        data_through = values.get("data_through")
        lag_days = _lag_days(data_through, today)
        # Negative lag means a future-dated upstream row; without this guard that layer
        # could never report stale again — a permanent blind spot for exactly the failure
        # this probe exists to catch.
        if lag_days is None or lag_days < 0 or lag_days > threshold:
            stale.append(
                {
                    "layer": layer,
                    "data_through": data_through if isinstance(data_through, str) else None,
                    "lag_days": lag_days,
                }
            )
    if stale:
        return JSONResponse(status_code=503, content={"status": "stale", "stale": stale})
    return JSONResponse(status_code=200, content={"status": "ok", "stale": []})

"""Server-side retention sweep for session-scoped analysis data.

A CompCat session is a 24h anonymous token, but the rows an analysis writes (place
clusters, analysis runs, crime summaries, statistical comparisons) outlive it: once the
token expires nobody — not the visitor, not an operator — can address them again. This
module is the only thing that removes them, on the window set by
MCA_SESSION_DATA_RETENTION_DAYS (0 disables).

Deletes run in bounded batches so a large backlog cannot hold a single long transaction
open against the production database, and children go before parents because the
statistical and summary foreign keys have no ON DELETE CASCADE.
"""
from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import (
    AnalysisRun,
    GeocodeCache,
    PlaceCluster,
    PlaceCrimeSummary,
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
    utc_now,
)
from app.services.manual_place_service import MANUAL_CLUSTER_METHOD

DEFAULT_BATCH_SIZE = 5000


def _delete_in_batches(session: Session, model, condition, batch_size: int) -> int:
    total = 0
    while True:
        victims = select(model.id).where(condition).limit(batch_size)
        deleted = session.execute(delete(model).where(model.id.in_(victims))).rowcount or 0
        session.commit()
        total += deleted
        if deleted < batch_size:
            return total


def sweep_retention(
    session: Session,
    settings: Settings,
    *,
    now: datetime | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
) -> dict[str, int]:
    now = now or utc_now()
    counts = {
        "statistical_pairwise_results": 0,
        "statistical_comparison_options": 0,
        "statistical_comparisons": 0,
        "analysis_runs": 0,
        "place_crime_summaries": 0,
        "place_clusters": 0,
        "geocode_cache": 0,
    }

    retention_days = settings.session_data_retention_days
    if retention_days > 0:
        cutoff = now - timedelta(days=retention_days)
        expired_comparisons = select(StatisticalComparison.id).where(
            StatisticalComparison.created_at < cutoff
        )
        # Options and pairwise results carry their own created_at, but the comparison is the
        # unit a user ever saw: pin the children to their parent's age so a sweep can never
        # strand a comparison with half its rows. option_id is plain text, not a key — the
        # foreign key is comparison_id.
        counts["statistical_pairwise_results"] = _delete_in_batches(
            session,
            StatisticalPairwiseResult,
            StatisticalPairwiseResult.comparison_id.in_(expired_comparisons),
            batch_size,
        )
        counts["statistical_comparison_options"] = _delete_in_batches(
            session,
            StatisticalComparisonOption,
            StatisticalComparisonOption.comparison_id.in_(expired_comparisons),
            batch_size,
        )
        counts["statistical_comparisons"] = _delete_in_batches(
            session,
            StatisticalComparison,
            StatisticalComparison.created_at < cutoff,
            batch_size,
        )
        counts["analysis_runs"] = _delete_in_batches(
            session, AnalysisRun, AnalysisRun.created_at < cutoff, batch_size
        )
        counts["place_crime_summaries"] = _delete_in_batches(
            session, PlaceCrimeSummary, PlaceCrimeSummary.created_at < cutoff, batch_size
        )
        # Manual (entered-place) clusters only. Upload-derived clusters belong to the
        # personal-upload delete path, and an expired cluster that a surviving summary still
        # points at stays until that summary ages out — the FK has no cascade.
        counts["place_clusters"] = _delete_in_batches(
            session,
            PlaceCluster,
            (PlaceCluster.cluster_method == MANUAL_CLUSTER_METHOD)
            & (PlaceCluster.created_at < cutoff)
            & PlaceCluster.id.not_in(select(PlaceCrimeSummary.place_cluster_id)),
            batch_size,
        )

    # The geocode cache is deliberately not user-scoped (it holds normalized query strings,
    # shared across sessions), so it is governed by its own TTL rather than the session
    # window — the same TTL that already gates reuse, now also evicting.
    if settings.geocoder_cache_ttl_days > 0:
        counts["geocode_cache"] = _delete_in_batches(
            session,
            GeocodeCache,
            GeocodeCache.created_at < now - timedelta(days=settings.geocoder_cache_ttl_days),
            batch_size,
        )

    return counts

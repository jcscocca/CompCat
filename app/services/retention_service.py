"""Server-side retention sweep for abandoned session data.

A CompCat session is an anonymous 24h token whose expiry SLIDES within a signed
absolute-age ceiling. Row age alone cannot distinguish "abandoned" from "long-lived":
the sweep keys on the OWNING IDENTITY instead. An identity is live if it has created or
resumed a session, run an analysis, created a place, or updated a place inside the
retention window. Everything belonging to identities silent for the whole window is
removed on the window set by MCA_SESSION_DATA_RETENTION_DAYS (0 disables).

Deletes run in bounded batches so a large backlog cannot hold a single long transaction
open against the production database, and children go before parents because the
statistical and summary foreign keys have no ON DELETE CASCADE.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, union
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import (
    AnalysisRun,
    GeocodeCache,
    PlaceCluster,
    PlaceCrimeSummary,
    SessionActivity,
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
    utc_now,
)
from app.services.manual_place_service import MANUAL_CLUSTER_METHOD

DEFAULT_BATCH_SIZE = 5000


def _delete_in_batches(session: Session, model, condition, batch_size: int) -> int:
    total = 0
    primary_key = next(iter(model.__table__.primary_key.columns))
    while True:
        victims = select(primary_key).where(condition).limit(batch_size)
        deleted = (
            session.execute(delete(model).where(primary_key.in_(victims))).rowcount or 0
        )
        session.commit()
        total += deleted
        if deleted < batch_size:
            return total


def _active_identities(cutoff: datetime) -> Any:
    """Identities with a recent visit, analysis, place creation, or place update."""
    return select(
        union(
            select(SessionActivity.user_id_hash).where(
                SessionActivity.last_seen_at >= cutoff
            ),
            select(AnalysisRun.user_id_hash).where(AnalysisRun.created_at >= cutoff),
            select(PlaceCluster.user_id_hash).where(PlaceCluster.created_at >= cutoff),
            select(PlaceCluster.user_id_hash).where(PlaceCluster.updated_at >= cutoff),
        ).subquery()
    )


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
        "session_activity": 0,
    }

    retention_days = settings.session_data_retention_days
    if retention_days > 0:
        cutoff = now - timedelta(days=retention_days)
        active = _active_identities(cutoff)

        def abandoned(model) -> Any:
            return (model.created_at < cutoff) & model.user_id_hash.not_in(active)

        expired_comparisons = select(StatisticalComparison.id).where(
            abandoned(StatisticalComparison)
        )
        # Options and pairwise results carry their own created_at, but the comparison is
        # the unit a user ever saw: pin the children to their parent so a sweep can never
        # strand a comparison with half its rows. option_id is plain text, not a key —
        # the foreign key is comparison_id.
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
            session, StatisticalComparison, abandoned(StatisticalComparison), batch_size
        )
        counts["analysis_runs"] = _delete_in_batches(
            session, AnalysisRun, abandoned(AnalysisRun), batch_size
        )
        counts["place_crime_summaries"] = _delete_in_batches(
            session, PlaceCrimeSummary, abandoned(PlaceCrimeSummary), batch_size
        )
        # Manual (entered-place) clusters only. Upload-derived clusters belong to the
        # personal-upload delete path, and an expired cluster that a surviving summary
        # still points at stays until that summary ages out — the FK has no cascade.
        counts["place_clusters"] = _delete_in_batches(
            session,
            PlaceCluster,
            (PlaceCluster.cluster_method == MANUAL_CLUSTER_METHOD)
            & abandoned(PlaceCluster)
            & PlaceCluster.id.not_in(select(PlaceCrimeSummary.place_cluster_id)),
            batch_size,
        )
        counts["session_activity"] = _delete_in_batches(
            session,
            SessionActivity,
            SessionActivity.last_seen_at < cutoff,
            batch_size,
        )

    # The geocode cache is deliberately not user-scoped (it holds normalized query
    # strings, shared across sessions), so it is governed by its own TTL rather than the
    # session window — the same TTL that already gates reuse, now also evicting.
    if settings.geocoder_cache_ttl_days > 0:
        counts["geocode_cache"] = _delete_in_batches(
            session,
            GeocodeCache,
            GeocodeCache.created_at < now - timedelta(days=settings.geocoder_cache_ttl_days),
            batch_size,
        )

    return counts

"""Server-side retention sweep for abandoned session data.

A CompCat session is an anonymous 24h token whose expiry SLIDES within a signed
absolute-age ceiling. Row age alone cannot distinguish "abandoned" from "long-lived":
the sweep keys on the OWNING IDENTITY instead. An identity is live if it has recently
created or resumed a session, run an analysis, saved a report, created or updated a place,
uploaded a batch, written staging rows, or created stops. Everything belonging to identities
silent for the whole window is removed on the window set by
MCA_SESSION_DATA_RETENTION_DAYS (0 disables), including clusters of every origin.

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
    AnalysisReportSnapshot,
    AnalysisRun,
    GeocodeCache,
    ImportBatch,
    PlaceCluster,
    PlaceCrimeSummary,
    SessionActivity,
    StagingLocationObservation,
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
    StopVisit,
    utc_now,
)

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
    """Identities with recent session, analysis/report, place, or upload activity."""
    return select(
        union(
            select(SessionActivity.user_id_hash).where(
                SessionActivity.last_seen_at >= cutoff
            ),
            select(AnalysisRun.user_id_hash).where(AnalysisRun.created_at >= cutoff),
            select(AnalysisReportSnapshot.user_id_hash).where(
                AnalysisReportSnapshot.created_at >= cutoff
            ),
            select(PlaceCluster.user_id_hash).where(PlaceCluster.created_at >= cutoff),
            select(PlaceCluster.user_id_hash).where(PlaceCluster.updated_at >= cutoff),
            select(ImportBatch.user_id_hash).where(ImportBatch.uploaded_at >= cutoff),
            select(StagingLocationObservation.user_id_hash).where(
                StagingLocationObservation.created_at >= cutoff
            ),
            select(StopVisit.user_id_hash).where(StopVisit.created_at >= cutoff),
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
        "analysis_report_snapshots": 0,
        "statistical_pairwise_results": 0,
        "statistical_comparison_options": 0,
        "statistical_comparisons": 0,
        "analysis_runs": 0,
        "place_crime_summaries": 0,
        "stop_visits": 0,
        "staging_location_observations": 0,
        "place_clusters": 0,
        "import_batches": 0,
        "geocode_cache": 0,
        "session_activity": 0,
    }

    retention_days = settings.session_data_retention_days
    if retention_days > 0:
        cutoff = now - timedelta(days=retention_days)
        active = _active_identities(cutoff)

        def abandoned(model) -> Any:
            return (model.created_at < cutoff) & model.user_id_hash.not_in(active)

        counts["analysis_report_snapshots"] = _delete_in_batches(
            session,
            AnalysisReportSnapshot,
            abandoned(AnalysisReportSnapshot),
            batch_size,
        )
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
        counts["stop_visits"] = _delete_in_batches(
            session, StopVisit, abandoned(StopVisit), batch_size
        )
        counts["staging_location_observations"] = _delete_in_batches(
            session,
            StagingLocationObservation,
            abandoned(StagingLocationObservation),
            batch_size,
        )
        # All cluster origins are session-owned. By this point abandoned summaries and stop
        # visits are gone; the NOT IN guards preserve any parent still referenced by a live row.
        counts["place_clusters"] = _delete_in_batches(
            session,
            PlaceCluster,
            abandoned(PlaceCluster)
            & PlaceCluster.id.not_in(select(PlaceCrimeSummary.place_cluster_id))
            # A retained raw upload may still reference its cluster through a StopVisit.
            # Keep that parent until the visit is eligible too.
            & PlaceCluster.id.not_in(
                select(StopVisit.place_cluster_id).where(
                    StopVisit.place_cluster_id.is_not(None)
                )
            ),
            batch_size,
        )
        counts["import_batches"] = _delete_in_batches(
            session,
            ImportBatch,
            (ImportBatch.uploaded_at < cutoff) & ImportBatch.user_id_hash.not_in(active),
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

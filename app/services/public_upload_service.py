from __future__ import annotations

import json

from sqlalchemy import delete, or_, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import (
    AnalysisRun,
    ImportBatch,
    PlaceCluster,
    PlaceCrimeSummary,
    StagingLocationObservation,
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
    StopVisit,
)
from app.normalization.clusters import CLUSTER_METHOD
from app.services.direct_places_service import DIRECT_CLUSTER_METHOD
from app.services.import_service import parse_upload, persist_point_import
from app.services.normalization_service import normalize_import


def run_personal_upload(
    session: Session,
    payload: bytes,
    filename: str,
    user_id_hash: str,
    settings: Settings,
) -> dict[str, object]:
    # parse_upload only matches the four point-data formats; non-point uploads raise
    # UnsupportedFormatError (callers map to HTTP 400).
    result = parse_upload(payload, filename)
    # Keep persistence + normalization in one transaction for the public path. Internal import
    # callers retain persist_point_import's commit-by-default behavior.
    batch = persist_point_import(
        session, result, payload, filename, user_id_hash, commit=False
    )
    batch_id = batch.id
    try:
        # The public default promises not to retain exact location rows. Normalize without
        # committing so parse, derived-row creation, raw disposal, and the batch-header removal
        # are one atomic transaction: a process exit before the final commit persists nothing.
        normalized = normalize_import(
            session, batch_id, user_id_hash, settings, commit=False
        )
        if not settings.raw_upload_retention:
            session.execute(
                delete(StagingLocationObservation).where(
                    StagingLocationObservation.import_id == batch_id
                )
            )
            session.execute(delete(StopVisit).where(StopVisit.import_id == batch_id))
            # The batch header contains the original filename, file hash, and time bounds. Once
            # exact rows are discarded it has no public-path purpose, so do not retain that
            # personal metadata as an orphaned upload receipt.
            session.execute(
                delete(ImportBatch).where(
                    ImportBatch.id == batch_id,
                    ImportBatch.user_id_hash == user_id_hash,
                )
            )
        session.commit()
    except Exception:
        # The ordinary path has no earlier commit, so rollback is sufficient. The cleanup is
        # defensive for an injected/future normalizer that violates commit=False and commits
        # before a later failure; never strand raw rows when propagating that error.
        session.rollback()
        cluster_ids = list(
            session.scalars(
                select(StopVisit.place_cluster_id).where(
                    StopVisit.import_id == batch_id,
                    StopVisit.user_id_hash == user_id_hash,
                    StopVisit.place_cluster_id.is_not(None),
                )
            )
        )
        if cluster_ids:
            session.execute(
                delete(PlaceCrimeSummary).where(
                    PlaceCrimeSummary.place_cluster_id.in_(cluster_ids)
                )
            )
        session.execute(delete(StopVisit).where(StopVisit.import_id == batch_id))
        session.execute(
            delete(StagingLocationObservation).where(
                StagingLocationObservation.import_id == batch_id
            )
        )
        session.execute(
            delete(PlaceCluster).where(
                PlaceCluster.id.in_(cluster_ids),
                PlaceCluster.user_id_hash == user_id_hash,
                PlaceCluster.cluster_method == CLUSTER_METHOD,
            )
        )
        session.execute(
            delete(ImportBatch).where(
                ImportBatch.id == batch_id,
                ImportBatch.user_id_hash == user_id_hash,
            )
        )
        session.commit()
        raise
    return {
        "import_id": batch_id,
        "place_cluster_count": normalized["place_cluster_count"],
        "source_type": result.source_type,
        "retained_raw": settings.raw_upload_retention,
    }


def delete_personal_data(session: Session, user_id_hash: str) -> dict[str, int]:
    upload_cluster_ids = set(
        session.scalars(
            select(PlaceCluster.id).where(
                PlaceCluster.user_id_hash == user_id_hash,
                PlaceCluster.cluster_method.in_((CLUSTER_METHOD, DIRECT_CLUSTER_METHOD)),
            )
        )
    )

    # Comparisons are run-owned records rather than children of PlaceCluster. Delete a whole
    # comparison only when one of its options is upload-derived; a mixed comparison cannot be
    # retained truthfully after that option disappears. Manual-only comparison history survives.
    comparison_ids: set[str] = set()
    if upload_cluster_ids:
        comparison_ids.update(
            session.scalars(
                select(StatisticalComparisonOption.comparison_id).where(
                    StatisticalComparisonOption.user_id_hash == user_id_hash,
                    StatisticalComparisonOption.option_id.in_(upload_cluster_ids),
                )
            )
        )
        comparison_ids.update(
            session.scalars(
                select(StatisticalPairwiseResult.comparison_id).where(
                    StatisticalPairwiseResult.user_id_hash == user_id_hash,
                    or_(
                        StatisticalPairwiseResult.option_a_id.in_(upload_cluster_ids),
                        StatisticalPairwiseResult.option_b_id.in_(upload_cluster_ids),
                    ),
                )
            )
        )
        comparison_ids.update(
            session.scalars(
                select(StatisticalComparison.id).where(
                    StatisticalComparison.user_id_hash == user_id_hash,
                    StatisticalComparison.recommendation_option_id.in_(upload_cluster_ids),
                )
            )
        )

    pairwise = session.execute(
        delete(StatisticalPairwiseResult).where(
            StatisticalPairwiseResult.comparison_id.in_(comparison_ids),
            StatisticalPairwiseResult.user_id_hash == user_id_hash,
        )
    ).rowcount or 0
    options = session.execute(
        delete(StatisticalComparisonOption).where(
            StatisticalComparisonOption.comparison_id.in_(comparison_ids),
            StatisticalComparisonOption.user_id_hash == user_id_hash,
        )
    ).rowcount or 0
    comparisons = session.execute(
        delete(StatisticalComparison).where(
            StatisticalComparison.id.in_(comparison_ids),
            StatisticalComparison.user_id_hash == user_id_hash,
        )
    ).rowcount or 0

    # Current runs name every selected place in JSON; legacy runs can still be identified by an
    # attached summary. As with comparisons, delete a whole mixed run but preserve manual-only
    # runs and summaries.
    run_ids: set[str] = set()
    if upload_cluster_ids:
        run_ids.update(
            run_id
            for run_id in session.scalars(
                select(PlaceCrimeSummary.analysis_run_id).where(
                    PlaceCrimeSummary.user_id_hash == user_id_hash,
                    PlaceCrimeSummary.place_cluster_id.in_(upload_cluster_ids),
                    PlaceCrimeSummary.analysis_run_id.is_not(None),
                )
            )
            if run_id is not None
        )
        for run in session.scalars(
            select(AnalysisRun).where(AnalysisRun.user_id_hash == user_id_hash)
        ):
            if _run_mentions_any_place(run.place_ids_json, upload_cluster_ids):
                run_ids.add(run.id)

    summary_predicate = PlaceCrimeSummary.place_cluster_id.in_(upload_cluster_ids)
    if run_ids:
        summary_predicate = or_(
            summary_predicate,
            PlaceCrimeSummary.analysis_run_id.in_(run_ids),
        )
    summaries = session.execute(
        delete(PlaceCrimeSummary).where(
            PlaceCrimeSummary.user_id_hash == user_id_hash,
            summary_predicate,
        )
    ).rowcount or 0
    runs = session.execute(
        delete(AnalysisRun).where(
            AnalysisRun.id.in_(run_ids),
            AnalysisRun.user_id_hash == user_id_hash,
        )
    ).rowcount or 0

    # Delete children before parents to satisfy foreign keys: StopVisit references both
    # PlaceCluster and ImportBatch; StagingLocationObservation references ImportBatch.
    stops = session.execute(
        delete(StopVisit).where(StopVisit.user_id_hash == user_id_hash)
    ).rowcount or 0
    staging = session.execute(
        delete(StagingLocationObservation).where(
            StagingLocationObservation.user_id_hash == user_id_hash
        )
    ).rowcount or 0
    clusters = session.execute(
        delete(PlaceCluster).where(
            PlaceCluster.user_id_hash == user_id_hash,
            PlaceCluster.cluster_method.in_((CLUSTER_METHOD, DIRECT_CLUSTER_METHOD)),
        )
    ).rowcount or 0
    batches = session.execute(
        delete(ImportBatch).where(ImportBatch.user_id_hash == user_id_hash)
    ).rowcount or 0
    session.commit()
    return {
        "import_batches": batches,
        "staging": staging,
        "stop_visits": stops,
        "place_clusters": clusters,
        "place_crime_summaries": summaries,
        "analysis_runs": runs,
        "statistical_comparisons": comparisons,
        "statistical_comparison_options": options,
        "statistical_pairwise_results": pairwise,
    }


def _run_mentions_any_place(raw_place_ids: str | None, place_ids: set[str]) -> bool:
    if raw_place_ids is None:
        return False
    try:
        decoded = json.loads(raw_place_ids)
    except (TypeError, json.JSONDecodeError):
        # UUIDs are sufficiently specific to recover an upload dependency from a malformed
        # legacy payload without broadening deletion to unrelated manual-only runs.
        return any(place_id in raw_place_ids for place_id in place_ids)
    return isinstance(decoded, list) and any(
        isinstance(place_id, str) and place_id in place_ids for place_id in decoded
    )

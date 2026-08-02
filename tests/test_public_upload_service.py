from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.config import Settings
from app.db import get_sessionmaker
from app.main import create_app
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
from app.services.import_service import create_import_batch
from app.services.manual_place_service import MANUAL_CLUSTER_METHOD, create_manual_place
from app.services.normalization_service import normalize_import

FIXTURES = Path(__file__).parent / "fixtures"
USER = "upload-user"


def _app_session(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'u.sqlite3'}")
    return get_sessionmaker()()


def _add_manual_place(session):
    from app.places.schemas import ManualPlaceCreate

    return create_manual_place(
        session, USER,
        ManualPlaceCreate(display_label="My desk", latitude=47.61, longitude=-122.33),
    )


def _add_comparison(session, option_ids: list[str]) -> StatisticalComparison:
    analysis_date = datetime(2026, 1, 1, tzinfo=UTC).date()
    comparison = StatisticalComparison(
        user_id_hash=USER,
        comparison_type="places",
        geometry_type="circle",
        radius_m=500,
        analysis_start_date=analysis_date,
        analysis_end_date=analysis_date,
        decision_class="not_statistically_clear",
        overview_summary_text="No clear difference.",
        overview_caveat_text="Reported context only.",
        full_caveat_text="Reported context only.",
    )
    session.add(comparison)
    session.flush()
    session.add_all(
        [
            StatisticalComparisonOption(
                comparison_id=comparison.id,
                user_id_hash=USER,
                option_id=option_id,
                option_label=f"Option {index}",
                geometry_type="circle",
                radius_m=500,
                incident_count=index,
                exposure=1.0,
                exposure_unit="square_km_days",
                incident_rate=float(index),
            )
            for index, option_id in enumerate(option_ids, start=1)
        ]
    )
    if len(option_ids) >= 2:
        session.add(
            StatisticalPairwiseResult(
                comparison_id=comparison.id,
                user_id_hash=USER,
                option_a_id=option_ids[0],
                option_a_label="Option 1",
                option_b_id=option_ids[1],
                option_b_label="Option 2",
                decision_class="not_statistically_clear",
                method="quasi_poisson_wald",
                incident_count_a=1,
                incident_count_b=2,
                exposure_a=1.0,
                exposure_b=1.0,
                exposure_unit="square_km_days",
                rate_a=1.0,
                rate_b=2.0,
                rate_ratio=0.5,
                ci_lower=0.1,
                ci_upper=2.0,
                p_value=0.5,
                adjusted_p_value=0.5,
                overdispersion_status="not_applied",
                minimum_data_status="sufficient",
                caveat_text="Reported context only.",
            )
        )
    session.commit()
    return comparison


def test_upload_normalize_preserves_manual_place(tmp_path):
    session = _app_session(tmp_path)
    _add_manual_place(session)
    batch = create_import_batch(
        session, (FIXTURES / "google_recurring.json").read_bytes(), "timeline.json", USER
    )
    normalize_import(session, batch["id"], USER, Settings())
    methods = {
        m for (m,) in session.query(PlaceCluster.cluster_method).filter(
            PlaceCluster.user_id_hash == USER
        )
    }
    assert MANUAL_CLUSTER_METHOD in methods  # manual place survived
    assert CLUSTER_METHOD in methods  # upload cluster created


def _staging_and_stops(session):
    staging = session.query(StagingLocationObservation).filter(
        StagingLocationObservation.user_id_hash == USER
    ).count()
    stops = session.query(StopVisit).filter(StopVisit.user_id_hash == USER).count()
    return staging, stops


def test_run_personal_upload_default_discards_raw_and_stops(tmp_path):
    from app.services.public_upload_service import run_personal_upload

    session = _app_session(tmp_path)
    result = run_personal_upload(
        session, (FIXTURES / "google_recurring.json").read_bytes(),
        "timeline.json", USER, Settings(),
    )
    assert result["place_cluster_count"] == 1
    assert result["retained_raw"] is False
    assert _staging_and_stops(session) == (0, 0)  # raw + stops discarded
    assert session.query(ImportBatch).filter(ImportBatch.user_id_hash == USER).count() == 0
    clusters = session.query(PlaceCluster).filter(PlaceCluster.user_id_hash == USER).count()
    assert clusters == 1  # the derived cluster is kept


def test_run_personal_upload_retains_when_opted_in(tmp_path):
    from app.services.public_upload_service import run_personal_upload

    session = _app_session(tmp_path)
    run_personal_upload(
        session, (FIXTURES / "google_recurring.json").read_bytes(),
        "timeline.json", USER, Settings(raw_upload_retention=True),
    )
    staging, stops = _staging_and_stops(session)
    assert staging > 0 and stops > 0
    assert session.query(ImportBatch).filter(ImportBatch.user_id_hash == USER).count() == 1


def test_second_retained_upload_preserves_first_import_clusters(tmp_path):
    from app.services.public_upload_service import run_personal_upload

    session = _app_session(tmp_path)
    settings = Settings(raw_upload_retention=True)
    payload = (FIXTURES / "google_recurring.json").read_bytes()

    first = run_personal_upload(session, payload, "first.json", USER, settings)
    second = run_personal_upload(session, payload, "second.json", USER, settings)

    assert first["place_cluster_count"] == 1
    assert second["place_cluster_count"] == 1
    assert session.query(PlaceCluster).filter(
        PlaceCluster.user_id_hash == USER,
        PlaceCluster.cluster_method == CLUSTER_METHOD,
    ).count() == 2
    assert {
        import_id
        for (import_id,) in session.query(StopVisit.import_id).filter(
            StopVisit.user_id_hash == USER
        )
    } == {first["import_id"], second["import_id"]}


def test_run_personal_upload_rejects_unknown_format(tmp_path):
    from app.parsers.base import UnsupportedFormatError
    from app.services.public_upload_service import run_personal_upload

    session = _app_session(tmp_path)
    with pytest.raises(UnsupportedFormatError):
        run_personal_upload(session, b"not a known format", "mystery.bin", USER, Settings())


def test_failed_normalization_leaves_no_upload_rows(tmp_path, monkeypatch):
    import app.services.public_upload_service as upload_service

    session = _app_session(tmp_path)

    def fail_normalization(db_session, batch_id, user_id_hash, _settings, **_kwargs):
        cluster = PlaceCluster(
            user_id_hash=user_id_hash,
            cluster_version="test",
            cluster_method=CLUSTER_METHOD,
            centroid_latitude=47.61,
            centroid_longitude=-122.33,
            display_latitude=47.61,
            display_longitude=-122.33,
            visit_count=1,
        )
        db_session.add(cluster)
        db_session.flush()
        start = datetime(2026, 1, 1, tzinfo=UTC)
        db_session.add(
            StopVisit(
                import_id=batch_id,
                user_id_hash=user_id_hash,
                place_cluster_id=cluster.id,
                start_time_utc=start,
                end_time_utc=start + timedelta(hours=1),
                duration_minutes=60,
                centroid_latitude=47.61,
                centroid_longitude=-122.33,
                source_basis="test",
            )
        )
        # Exercise the defensive branch for a future normalizer that commits before a later
        # post-processing failure, not only the ordinary same-transaction rollback path.
        db_session.commit()
        raise RuntimeError("normalization failed")

    monkeypatch.setattr(upload_service, "normalize_import", fail_normalization)

    with pytest.raises(RuntimeError, match="normalization failed"):
        upload_service.run_personal_upload(
            session,
            (FIXTURES / "google_recurring.json").read_bytes(),
            "timeline.json",
            USER,
            Settings(),
        )

    for model in (ImportBatch, StagingLocationObservation, StopVisit, PlaceCluster):
        assert session.query(model).filter(model.user_id_hash == USER).count() == 0


def test_failure_after_uncommitted_normalization_rolls_back_raw_rows(tmp_path, monkeypatch):
    import app.services.public_upload_service as upload_service

    session = _app_session(tmp_path)
    real_normalize = upload_service.normalize_import

    def fail_after_normalization(
        db_session, batch_id, user_id_hash, settings, *, commit=True
    ):
        real_normalize(db_session, batch_id, user_id_hash, settings, commit=commit)
        assert commit is False
        assert db_session.query(StagingLocationObservation).count() > 0
        assert db_session.query(StopVisit).count() > 0
        raise RuntimeError("post-normalization failure")

    monkeypatch.setattr(upload_service, "normalize_import", fail_after_normalization)

    with pytest.raises(RuntimeError, match="post-normalization failure"):
        upload_service.run_personal_upload(
            session,
            (FIXTURES / "google_recurring.json").read_bytes(),
            "timeline.json",
            USER,
            Settings(),
        )

    for model in (ImportBatch, StagingLocationObservation, StopVisit, PlaceCluster):
        assert session.query(model).filter(model.user_id_hash == USER).count() == 0


def test_delete_personal_data_erases_upload_keeps_manual(tmp_path):
    from app.services.public_upload_service import delete_personal_data, run_personal_upload

    session = _app_session(tmp_path)
    manual_place = _add_manual_place(session)
    result = run_personal_upload(
        session, (FIXTURES / "google_recurring.json").read_bytes(),
        "timeline.json", USER, Settings(raw_upload_retention=True),
    )
    upload_cluster = session.query(PlaceCluster).filter(
        PlaceCluster.user_id_hash == USER,
        PlaceCluster.cluster_method == CLUSTER_METHOD,
    ).one()
    analysis_run = AnalysisRun(
        user_id_hash=USER,
        analysis_start_date=upload_cluster.created_at.date(),
        analysis_end_date=upload_cluster.created_at.date(),
        radii_m_json="[500]",
        place_ids_json=json.dumps([upload_cluster.id]),
    )
    manual_run = AnalysisRun(
        user_id_hash=USER,
        analysis_start_date=upload_cluster.created_at.date(),
        analysis_end_date=upload_cluster.created_at.date(),
        radii_m_json="[500]",
        place_ids_json=json.dumps([manual_place.id]),
    )
    malformed_upload_run = AnalysisRun(
        user_id_hash=USER,
        analysis_start_date=upload_cluster.created_at.date(),
        analysis_end_date=upload_cluster.created_at.date(),
        radii_m_json="[500]",
        place_ids_json=f"legacy-broken:[{upload_cluster.id}",
    )
    session.add_all([analysis_run, manual_run, malformed_upload_run])
    session.flush()
    session.add_all(
        [PlaceCrimeSummary(
            user_id_hash=USER,
            place_cluster_id=upload_cluster.id,
            radius_m=500,
            analysis_start_date=upload_cluster.created_at.date(),
            analysis_end_date=upload_cluster.created_at.date(),
            incident_count=0,
            analysis_run_id=analysis_run.id,
        ), PlaceCrimeSummary(
            user_id_hash=USER,
            place_cluster_id=manual_place.id,
            radius_m=500,
            analysis_start_date=upload_cluster.created_at.date(),
            analysis_end_date=upload_cluster.created_at.date(),
            incident_count=4,
            analysis_run_id=manual_run.id,
        )]
    )
    session.commit()
    upload_comparison = _add_comparison(session, [upload_cluster.id, manual_place.id])
    manual_comparison = _add_comparison(session, [manual_place.id])
    analysis_run_id = analysis_run.id
    manual_run_id = manual_run.id
    malformed_upload_run_id = malformed_upload_run.id
    upload_comparison_id = upload_comparison.id
    manual_comparison_id = manual_comparison.id

    counts = delete_personal_data(session, USER)
    assert counts["place_clusters"] >= 1
    assert counts["import_batches"] == 1
    assert counts["place_crime_summaries"] == 1
    assert counts["analysis_runs"] == 2
    assert counts["statistical_comparisons"] == 1
    assert counts["statistical_comparison_options"] == 2
    assert counts["statistical_pairwise_results"] == 1
    remaining = {
        m for (m,) in session.query(PlaceCluster.cluster_method).filter(
            PlaceCluster.user_id_hash == USER
        )
    }
    assert remaining == {MANUAL_CLUSTER_METHOD}  # only the manual place survives
    assert _staging_and_stops(session) == (0, 0)
    assert session.get(ImportBatch, result["import_id"]) is None
    assert session.get(AnalysisRun, analysis_run_id) is None
    assert session.get(AnalysisRun, malformed_upload_run_id) is None
    assert session.get(AnalysisRun, manual_run_id) is not None
    assert session.get(StatisticalComparison, upload_comparison_id) is None
    assert session.get(StatisticalComparison, manual_comparison_id) is not None
    assert session.query(PlaceCrimeSummary).filter(
        PlaceCrimeSummary.user_id_hash == USER
    ).one().place_cluster_id == manual_place.id

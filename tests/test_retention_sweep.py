"""Server-side retention sweep.

Sessions are 24h anonymous tokens, but the rows an analysis leaves behind (clusters,
runs, summaries, comparisons) outlive them and are addressable by nobody once the token
expires. The sweep is the only thing that ever removes them.
"""
from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import func, select

from app.config import get_settings
from app.db import get_sessionmaker
from app.main import create_app
from app.models import (
    AnalysisRun,
    GeocodeCache,
    PlaceCluster,
    PlaceCrimeSummary,
    StatisticalComparison,
    StatisticalComparisonOption,
    StatisticalPairwiseResult,
)
from app.normalization.clusters import CLUSTER_METHOD
from app.services.manual_place_service import MANUAL_CLUSTER_METHOD
from app.services.retention_service import sweep_retention

NOW = datetime(2026, 7, 27, 12, 0, tzinfo=UTC)
OLD = NOW - timedelta(days=40)
FRESH = NOW - timedelta(days=2)


def _session(tmp_path, name: str = "retention"):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / f'{name}.sqlite3'}")
    return get_sessionmaker()()


def _cluster(created_at: datetime, method: str = MANUAL_CLUSTER_METHOD) -> PlaceCluster:
    return PlaceCluster(
        user_id_hash="user-hash",
        cluster_version="manual-1",
        cluster_method=method,
        centroid_latitude=47.61,
        centroid_longitude=-122.33,
        display_latitude=47.61,
        display_longitude=-122.33,
        visit_count=1,
        label_source="manual",
        created_at=created_at,
        updated_at=created_at,
    )


def _summary(cluster_id: str, created_at: datetime) -> PlaceCrimeSummary:
    return PlaceCrimeSummary(
        user_id_hash="user-hash",
        place_cluster_id=cluster_id,
        radius_m=500,
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        incident_count=3,
        created_at=created_at,
    )


def _run(created_at: datetime) -> AnalysisRun:
    return AnalysisRun(
        user_id_hash="user-hash",
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        radii_m_json="[500]",
        created_at=created_at,
    )


def _comparison(created_at: datetime) -> StatisticalComparison:
    return StatisticalComparison(
        user_id_hash="user-hash",
        comparison_type="site",
        geometry_type="place_buffer",
        radius_m=500,
        analysis_start_date=date(2026, 1, 1),
        analysis_end_date=date(2026, 6, 30),
        decision_class="not_clear",
        overview_summary_text="s",
        overview_caveat_text="c",
        full_caveat_text="fc",
        created_at=created_at,
    )


def _option(comparison_id: str, created_at: datetime) -> StatisticalComparisonOption:
    return StatisticalComparisonOption(
        comparison_id=comparison_id,
        user_id_hash="user-hash",
        option_id="option-a",
        option_label="Option A",
        geometry_type="place_buffer",
        radius_m=500,
        incident_count=5,
        exposure=10.0,
        exposure_unit="square_km_days",
        incident_rate=0.5,
        created_at=created_at,
    )


def _pairwise(comparison_id: str, created_at: datetime) -> StatisticalPairwiseResult:
    return StatisticalPairwiseResult(
        comparison_id=comparison_id,
        user_id_hash="user-hash",
        option_a_id="option-a",
        option_a_label="Option A",
        option_b_id="option-b",
        option_b_label="Option B",
        decision_class="not_clear",
        method="exact_conditional_poisson",
        incident_count_a=5,
        incident_count_b=7,
        exposure_a=10.0,
        exposure_b=10.0,
        exposure_unit="square_km_days",
        rate_a=0.5,
        rate_b=0.7,
        rate_ratio=0.71,
        ci_lower=0.2,
        ci_upper=2.5,
        p_value=0.3,
        adjusted_p_value=0.3,
        overdispersion_status="poisson_ok",
        minimum_data_status="met",
        caveat_text="",
    )


def _count(session, model) -> int:
    return session.scalar(select(func.count()).select_from(model))


def test_sweep_deletes_expired_rows_and_keeps_recent_ones(tmp_path):
    session = _session(tmp_path)
    old_cluster, fresh_cluster = _cluster(OLD), _cluster(FRESH)
    session.add_all([old_cluster, fresh_cluster])
    session.flush()
    old_comparison, fresh_comparison = _comparison(OLD), _comparison(FRESH)
    session.add_all([old_comparison, fresh_comparison])
    session.flush()
    session.add_all(
        [
            _summary(old_cluster.id, OLD),
            _summary(fresh_cluster.id, FRESH),
            _run(OLD),
            _run(FRESH),
            _option(old_comparison.id, OLD),
            _option(fresh_comparison.id, FRESH),
            _pairwise(old_comparison.id, OLD),
            _pairwise(fresh_comparison.id, FRESH),
        ]
    )
    session.commit()

    counts = sweep_retention(session, get_settings(), now=NOW)

    assert counts == {
        "statistical_pairwise_results": 1,
        "statistical_comparison_options": 1,
        "statistical_comparisons": 1,
        "analysis_runs": 1,
        "place_crime_summaries": 1,
        "place_clusters": 1,
        "geocode_cache": 0,
    }
    assert _count(session, PlaceCluster) == 1
    assert _count(session, PlaceCrimeSummary) == 1
    assert _count(session, AnalysisRun) == 1
    assert _count(session, StatisticalComparison) == 1
    assert _count(session, StatisticalComparisonOption) == 1
    assert _count(session, StatisticalPairwiseResult) == 1
    assert session.get(PlaceCluster, fresh_cluster.id) is not None
    assert session.get(StatisticalComparison, fresh_comparison.id) is not None
    session.close()


def test_sweep_never_touches_upload_derived_clusters(tmp_path):
    # Upload-derived clusters have their own delete path (public_upload_service); the sweep
    # must not reach into personal-upload data even when it is older than the window.
    session = _session(tmp_path, "uploads")
    upload_cluster = _cluster(OLD, method=CLUSTER_METHOD)
    manual_cluster = _cluster(OLD)
    session.add_all([upload_cluster, manual_cluster])
    session.commit()
    upload_id, manual_id = upload_cluster.id, manual_cluster.id

    counts = sweep_retention(session, get_settings(), now=NOW)

    assert counts["place_clusters"] == 1
    assert session.get(PlaceCluster, upload_id) is not None
    assert session.get(PlaceCluster, manual_id) is None
    session.close()


def test_sweep_keeps_an_expired_cluster_that_a_live_summary_still_references(tmp_path):
    # place_crime_summaries.place_cluster_id is a real FK: deleting the parent under a
    # summary that survived the window would raise, not cascade.
    session = _session(tmp_path, "fk")
    cluster = _cluster(OLD)
    session.add(cluster)
    session.flush()
    session.add(_summary(cluster.id, FRESH))
    session.commit()

    counts = sweep_retention(session, get_settings(), now=NOW)

    assert counts["place_clusters"] == 0
    assert session.get(PlaceCluster, cluster.id) is not None
    session.close()


def test_sweep_batches_until_the_backlog_is_gone(tmp_path):
    session = _session(tmp_path, "batching")
    session.add_all([_run(OLD) for _ in range(7)])
    session.commit()

    counts = sweep_retention(session, get_settings(), now=NOW, batch_size=2)

    assert counts["analysis_runs"] == 7
    assert _count(session, AnalysisRun) == 0
    session.close()


def test_sweep_is_disabled_by_a_zero_window(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_SESSION_DATA_RETENTION_DAYS", "0")
    get_settings.cache_clear()
    session = _session(tmp_path, "disabled")
    session.add_all([_cluster(OLD), _run(OLD)])
    session.add(
        GeocodeCache(
            provider="nominatim",
            query_normalized="pike place market",
            results_json="[]",
            created_at=OLD,
        )
    )
    session.commit()

    counts = sweep_retention(session, get_settings(), now=NOW)

    assert counts["place_clusters"] == 0
    assert counts["analysis_runs"] == 0
    assert _count(session, PlaceCluster) == 1
    assert _count(session, AnalysisRun) == 1
    # The geocode cache is not session-scoped; its own TTL governs it either way.
    assert counts["geocode_cache"] == 1
    session.close()


def test_sweep_prunes_the_geocode_cache_by_its_own_ttl(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_GEOCODER_CACHE_TTL_DAYS", "10")
    get_settings.cache_clear()
    session = _session(tmp_path, "geocode")
    session.add_all(
        [
            GeocodeCache(
                provider="nominatim",
                query_normalized="stale entry",
                results_json="[]",
                created_at=NOW - timedelta(days=11),
            ),
            GeocodeCache(
                provider="nominatim",
                query_normalized="live entry",
                results_json="[]",
                created_at=NOW - timedelta(days=9),
            ),
        ]
    )
    session.commit()

    counts = sweep_retention(session, get_settings(), now=NOW)

    assert counts["geocode_cache"] == 1
    remaining = session.scalars(select(GeocodeCache.query_normalized)).all()
    assert remaining == ["live entry"]
    session.close()


def test_retention_sweep_endpoint_requires_the_admin_token(tmp_path, monkeypatch):
    monkeypatch.delenv("MCA_ADMIN_INGEST_TOKEN", raising=False)
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'admin.sqlite3'}")
    client = TestClient(app)

    no_token = client.post("/admin/maintenance/retention-sweep")
    assert no_token.status_code == 403
    assert no_token.json()["detail"] == "Admin token required"

    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    get_settings.cache_clear()
    wrong_token = client.post(
        "/admin/maintenance/retention-sweep",
        headers={"X-Admin-Token": "wrong-token"},
    )
    assert wrong_token.status_code == 403


def test_retention_sweep_endpoint_returns_counts_only(tmp_path, monkeypatch):
    monkeypatch.setenv("MCA_ADMIN_INGEST_TOKEN", "secret-token")
    get_settings.cache_clear()
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'sweep.sqlite3'}")
    session = get_sessionmaker()()
    session.add_all([_cluster(OLD), _run(OLD)])
    session.commit()
    session.close()

    response = TestClient(app).post(
        "/admin/maintenance/retention-sweep",
        headers={"X-Admin-Token": "secret-token"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["place_clusters"] == 1
    assert payload["analysis_runs"] == 1
    assert all(isinstance(value, int) for value in payload.values())


def test_retention_sweep_endpoint_is_absent_from_the_public_schema(tmp_path):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'schema.sqlite3'}")
    schema = TestClient(app).get("/openapi.json").json()
    assert "/admin/maintenance/retention-sweep" not in schema["paths"]

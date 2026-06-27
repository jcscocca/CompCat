from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.db import get_sessionmaker
from app.main import create_app
from app.models import PlaceCluster, StagingLocationObservation, StopVisit
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

    create_manual_place(
        session, USER,
        ManualPlaceCreate(display_label="My desk", latitude=47.61, longitude=-122.33),
    )


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


def test_run_personal_upload_rejects_unknown_format(tmp_path):
    import pytest

    from app.parsers.base import UnsupportedFormatError
    from app.services.public_upload_service import run_personal_upload

    session = _app_session(tmp_path)
    with pytest.raises(UnsupportedFormatError):
        run_personal_upload(session, b"not a known format", "mystery.bin", USER, Settings())


def test_delete_personal_data_erases_upload_keeps_manual(tmp_path):
    from app.services.public_upload_service import delete_personal_data, run_personal_upload

    session = _app_session(tmp_path)
    _add_manual_place(session)
    run_personal_upload(
        session, (FIXTURES / "google_recurring.json").read_bytes(),
        "timeline.json", USER, Settings(raw_upload_retention=True),
    )
    counts = delete_personal_data(session, USER)
    assert counts["place_clusters"] >= 1
    remaining = {
        m for (m,) in session.query(PlaceCluster.cluster_method).filter(
            PlaceCluster.user_id_hash == USER
        )
    }
    assert remaining == {MANUAL_CLUSTER_METHOD}  # only the manual place survives
    assert _staging_and_stops(session) == (0, 0)

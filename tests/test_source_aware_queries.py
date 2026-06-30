from datetime import UTC, date, datetime

from app.crime.sources import SOURCE_SPD_ARRESTS, SOURCE_SPD_CRIME
from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident
from app.schemas import PlaceClusterData
from app.services.crime_service import _incidents_near_clusters
from app.services.dashboard_analysis_service import _filtered_incidents
from app.services.incident_query_service import BoundingBox, incidents_in_bbox
from app.services.neighborhood_service import _beat_incidents

_START = date(2024, 1, 1)
_END = date(2024, 1, 31)


def _seed_two_sources(session):
    session.add_all(
        [
            CrimeIncident(
                external_incident_id="rep-1",
                source_dataset=SOURCE_SPD_CRIME,
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                beat="K1",
                latitude=47.609,
                longitude=-122.333,
            ),
            CrimeIncident(
                external_incident_id="arr-1",
                source_dataset=SOURCE_SPD_ARRESTS,
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                beat="K1",
                latitude=47.609,
                longitude=-122.333,
            ),
        ]
    )
    session.commit()


def _cluster() -> PlaceClusterData:
    return PlaceClusterData(
        id="place-1",
        user_id_hash="u",
        cluster_version="t",
        cluster_method="manual",
        centroid_latitude=47.609,
        centroid_longitude=-122.333,
        display_latitude=47.609,
        display_longitude=-122.333,
        visit_count=3,
    )


def test_incidents_in_bbox_defaults_to_reports(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    _seed_two_sources(session)
    box = BoundingBox(min_lat=47.6, max_lat=47.62, min_lon=-122.34, max_lon=-122.32)
    default = incidents_in_bbox(
        session, box=box, analysis_start_date=_START, analysis_end_date=_END
    )
    arrests = incidents_in_bbox(
        session, box=box, analysis_start_date=_START, analysis_end_date=_END,
        source_dataset=SOURCE_SPD_ARRESTS,
    )
    assert [i.external_incident_id for i in default] == ["rep-1"]
    assert [i.external_incident_id for i in arrests] == ["arr-1"]
    session.close()


def test_filtered_incidents_defaults_to_reports(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    _seed_two_sources(session)
    default = _filtered_incidents(
        session, clusters=[_cluster()], radii_m=[500],
        analysis_start_date=_START, analysis_end_date=_END,
        offense_category=None, offense_subcategory=None, nibrs_group=None,
    )
    arrests = _filtered_incidents(
        session, clusters=[_cluster()], radii_m=[500],
        analysis_start_date=_START, analysis_end_date=_END,
        offense_category=None, offense_subcategory=None, nibrs_group=None,
        source_dataset=SOURCE_SPD_ARRESTS,
    )
    assert [i.external_incident_id for i in default] == ["rep-1"]
    assert [i.external_incident_id for i in arrests] == ["arr-1"]
    session.close()


def test_beat_incidents_defaults_to_reports(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    _seed_two_sources(session)
    default = _beat_incidents(session, "K1", _START, _END, None, None, None)
    arrests = _beat_incidents(
        session, "K1", _START, _END, None, None, None, source_dataset=SOURCE_SPD_ARRESTS
    )
    assert [i.external_incident_id for i in default] == ["rep-1"]
    assert [i.external_incident_id for i in arrests] == ["arr-1"]
    session.close()


def test_incidents_near_clusters_defaults_to_reports(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    _seed_two_sources(session)
    default = _incidents_near_clusters(session, [_cluster()], [500], _START, _END)
    arrests = _incidents_near_clusters(
        session, [_cluster()], [500], _START, _END, source_dataset=SOURCE_SPD_ARRESTS
    )
    assert [i.external_incident_id for i in default] == ["rep-1"]
    assert [i.external_incident_id for i in arrests] == ["arr-1"]
    session.close()

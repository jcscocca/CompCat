from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident


def test_same_external_id_coexists_across_sources(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                external_incident_id="shared-1",
                source_dataset="seattle_spd_crime",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                latitude=47.6,
                longitude=-122.33,
            ),
            CrimeIncident(
                external_incident_id="shared-1",
                source_dataset="seattle_spd_arrests",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                latitude=47.6,
                longitude=-122.33,
            ),
        ]
    )
    session.commit()
    rows = session.scalars(
        select(CrimeIncident).order_by(CrimeIncident.source_dataset)
    ).all()
    assert [r.source_dataset for r in rows] == ["seattle_spd_arrests", "seattle_spd_crime"]
    session.close()


def test_same_source_duplicate_external_id_is_rejected(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add_all(
        [
            CrimeIncident(
                external_incident_id="dup-1",
                source_dataset="seattle_spd_crime",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                latitude=47.6,
                longitude=-122.33,
            ),
            CrimeIncident(
                external_incident_id="dup-1",
                source_dataset="seattle_spd_crime",
                offense_start_utc=datetime(2024, 1, 10, tzinfo=UTC),
                latitude=47.6,
                longitude=-122.33,
            ),
        ]
    )
    with pytest.raises(IntegrityError):
        session.commit()
    session.rollback()
    session.close()

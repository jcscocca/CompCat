from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.db import get_sessionmaker
from app.main import create_app
from app.models import CrimeIncident, PlaceCluster
from app.sessions import public_user_hash


def square_beat_polygons(beat: str, lat: float, lon: float, half: float = 0.05):
    """A single square beat polygon (~11 km across at ``half=0.05``) centred on
    ``(lat, lon)``, in the ``BeatPolygons`` shape. Lets direct-call unit tests pin a
    deterministic point-in-polygon beat assignment without loading the real geometry."""
    ring = [
        (lon - half, lat - half),
        (lon + half, lat - half),
        (lon + half, lat + half),
        (lon - half, lat + half),
        (lon - half, lat - half),
    ]
    return {beat: [[ring]]}


def session_with_places_and_beat_crime(tmp_path) -> tuple[Session, str, str]:
    """Seed one place plus SPD beat-tagged crime for neighborhood analysis tests.

    Inserts a single ``PlaceCluster`` at a downtown point that the real beat polygons
    (and ``square_beat_polygons("M3", ...)``) resolve to beat ``M3``, several
    ``CrimeIncident`` rows WITHIN 250 m carrying ``beat="M3"``/``mcpp="TEST HILL"``,
    and additional rows OUTSIDE the 250 m buffer with the same tags (so the beat-wide
    incident count exceeds the place count). All incidents are dated across
    2026-01..2026-06 so a
    full-range analysis has both positive place and beat rates while a short sub-range
    falls below the minimum analysis-window length.

    Returns ``(session, user_id_hash, place_id)``.
    """
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'neighborhood.sqlite3'}")
    sessionmaker = get_sessionmaker()

    # Establish a public session so we have a real user hash to scope the place to.
    from fastapi.testclient import TestClient

    client = TestClient(app)
    client.post("/sessions")
    user_hash = public_user_hash(client.cookies.get("mca_session"))
    assert user_hash is not None

    place_id = "neighborhood-place"
    # Deep in beat M3's interior (clear M3 under ~165 m perturbation), so the real-asset
    # tests don't sit on the M3/M2 boundary where a future polygon revision could flip them.
    place_lat = 47.60945
    place_lon = -122.33595

    session = sessionmaker()
    session.add(
        PlaceCluster(
            id=place_id,
            user_id_hash=user_hash,
            cluster_version="test",
            cluster_method="manual",
            centroid_latitude=47.5900,
            centroid_longitude=-122.2900,
            display_latitude=place_lat,
            display_longitude=place_lon,
            visit_count=8,
            inferred_place_type="manual_place",
            sensitivity_class="normal",
            display_label="Neighborhood place",
            label_source="test",
        )
    )

    # Incidents WITHIN ~250 m, beat "M2", spread across 2026-01..2026-06.
    # These count toward both the place (radius filter) and the beat (beat query).
    near_offsets = [
        (0.0005, 0.0),
        (0.0008, 0.0003),
        (0.0, 0.0010),
        (0.0012, 0.0),
        (-0.0007, 0.0005),
    ]
    near_months = [1, 2, 3, 4, 5]
    for index, ((dlat, dlon), month) in enumerate(zip(near_offsets, near_months, strict=True)):
        session.add(
            CrimeIncident(
                id=f"near-{index}",
                offense_start_utc=datetime(2026, month, 12, tzinfo=UTC),
                offense_category="PROPERTY",
                offense_subcategory="Theft",
                nibrs_group="PROPERTY",
                beat="M3",
                mcpp="TEST HILL",
                latitude=place_lat + dlat,
                longitude=place_lon + dlon,
            )
        )

    # Incidents OUTSIDE ~250 m, beat "M2", spread across 2026-01..2026-06. These
    # belong to the beat but not the place buffer, so beat_count > place_count.
    far_offsets = [
        (0.0040, 0.0),
        (0.0, 0.0060),
        (0.0045, 0.0030),
        (-0.0050, 0.0),
        (0.0050, -0.0040),
        (0.0, -0.0065),
        (-0.0048, 0.0035),
        (0.0042, 0.0042),
    ]
    far_months = [1, 2, 3, 4, 5, 6, 1, 3]
    for index, ((dlat, dlon), month) in enumerate(zip(far_offsets, far_months, strict=True)):
        session.add(
            CrimeIncident(
                id=f"far-{index}",
                offense_start_utc=datetime(2026, month, 18, tzinfo=UTC),
                offense_category="PROPERTY",
                offense_subcategory="Burglary",
                nibrs_group="PROPERTY",
                beat="M3",
                mcpp="TEST HILL",
                latitude=place_lat + dlat,
                longitude=place_lon + dlon,
            )
        )

    session.commit()
    return session, user_hash, place_id

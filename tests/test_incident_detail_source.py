from app.schemas import CrimeIncidentData, PlaceClusterData
from app.services.dashboard_analysis_service import _incident_detail_rows


def test_incident_detail_rows_include_source_dataset():
    cluster = PlaceClusterData(
        id="place-1",
        user_id_hash="u",
        cluster_version="t",
        cluster_method="manual",
        centroid_latitude=47.609,
        centroid_longitude=-122.333,
        display_latitude=47.609,
        display_longitude=-122.333,
        visit_count=3,
        display_label="Home",
    )
    incident = CrimeIncidentData(
        id="i1",
        external_incident_id="rep-1",
        source_dataset="seattle_spd_crime",
        latitude=47.609,
        longitude=-122.333,
    )
    rows = _incident_detail_rows([cluster], [incident], radius_m=500)
    assert rows
    assert rows[0]["source_dataset"] == "seattle_spd_crime"

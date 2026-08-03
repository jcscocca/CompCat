from __future__ import annotations

import json
from datetime import UTC, datetime

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import func, select

from app.db import get_sessionmaker
from app.main import create_app
from app.models import AnalysisReportSnapshot, CrimeIncident, PlaceCluster
from app.reports.schemas import AnalysisReport
from app.sessions import public_user_hash


def _client(tmp_path, name: str = "reports") -> tuple[object, TestClient]:
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / f'{name}.sqlite3'}")
    client = TestClient(app)
    assert client.post("/sessions").status_code == 200
    return app, client


def _place(client: TestClient, label: str, latitude: float, longitude: float) -> str:
    response = client.post(
        "/places",
        json={
            "display_label": label,
            "latitude": latitude,
            "longitude": longitude,
            "visit_count": 1,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def _incident(
    *,
    incident_id: str,
    source_dataset: str,
    observed_at: datetime,
    latitude: float,
    longitude: float,
    subcategory: str,
) -> CrimeIncident:
    return CrimeIncident(
        id=incident_id,
        external_incident_id=f"external-{incident_id}",
        source_dataset=source_dataset,
        offense_start_utc=observed_at,
        offense_subcategory=subcategory,
        latitude=latitude,
        longitude=longitude,
    )


def _reported_request(place_ids: list[str]) -> dict[str, object]:
    return {
        "place_ids": place_ids,
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2024-01-31",
        "radius_m": 250,
        "layer": "reported",
    }


def test_report_profiles_define_distinct_layer_semantics(tmp_path):
    _, client = _client(tmp_path, "profiles")

    response = client.get("/dashboard/report-profiles")

    assert response.status_code == 200
    profiles = {profile["layer"]: profile for profile in response.json()}
    assert list(profiles) == ["reported", "arrests", "calls"]
    assert profiles["reported"]["counting_unit"] == "reported_offense_record"
    assert profiles["reported"]["capabilities"]["reference_context"] is True
    assert profiles["arrests"]["subtype_field"] == "arrest_offense_description"
    assert "arrest_offense_description" in profiles["arrests"]["supported_filters"]
    assert profiles["arrests"]["capabilities"]["modeled_comparison"] is False
    assert profiles["calls"]["counting_unit"] == "deduplicated_cad_event"
    assert profiles["calls"]["supported_filters"] == ["call_type"]


def test_call_report_is_descriptive_nonpersistent_and_uses_surface_vocabulary(tmp_path):
    _, client = _client(tmp_path, "calls")
    with get_sessionmaker()() as session:
        session.add(
            _incident(
                incident_id="call-1",
                source_dataset="seattle_spd_911",
                observed_at=datetime(2026, 7, 10, 14, 30, tzinfo=UTC),
                latitude=47.6092,
                longitude=-122.3335,
                subcategory="DISTURBANCE - OTHER",
            )
        )
        session.commit()

    response = client.post(
        "/dashboard/reports",
        json={
            "points": [
                {
                    "label": "Ad-hoc point",
                    "latitude": 47.609123,
                    "longitude": -122.333456,
                }
            ],
            "analysis_start_date": "2026-07-01",
            "analysis_end_date": "2026-07-31",
            "radius_m": 250,
            "layer": "calls",
            "call_type": "DISTURBANCE - OTHER",
        },
    )

    assert response.status_code == 200
    report = response.json()
    assert report["report_id"] is None
    assert report["profile"]["report_title"] == "911 Call Activity Report"
    assert report["comparison_mode"] == "none"
    assert report["selection"] == [
        {
            "selection_id": "selection-1",
            "label": "Ad-hoc point",
            "latitude": 47.609,
            "longitude": -122.333,
        }
    ]
    assert report["sections"]["overview"] == {
        "counting_unit": "deduplicated_cad_event",
        "unique_counting_basis": "unique_source_records",
        "membership_counting_basis": "per_place_membership",
        "unique_source_record_count": 1,
        "membership_count": 1,
        "returned_record_count": 1,
        "record_limit": 100,
        "records_truncated": False,
    }
    place_context = report["sections"]["place_context"][0]
    assert place_context["reference_context"] == []
    assert place_context["type_mix"][0]["label"] == "DISTURBANCE - OTHER"
    assert place_context["type_mix"][0]["counting_unit"] == "deduplicated_cad_event"
    assert report["scope"]["filters"]["call_type"] == "DISTURBANCE - OTHER"
    assert report["scope"]["filters"]["offense_subcategory"] is None
    record = report["sections"]["records"]["records"][0]
    assert record["call_type"] == "DISTURBANCE - OTHER"
    assert record["offense_subcategory"] is None
    assert record["arrest_offense_description"] is None
    assert "incident_id" not in record
    assert "external_incident_id" not in record
    assert report["export_policy"]["persisted_server_side"] is False
    with get_sessionmaker()() as session:
        assert session.scalar(select(func.count()).select_from(AnalysisReportSnapshot)) == 0


def test_arrest_report_uses_arrest_specific_filter_and_record_vocabulary(tmp_path):
    _, client = _client(tmp_path, "arrests")
    with get_sessionmaker()() as session:
        session.add(
            _incident(
                incident_id="arrest-1",
                source_dataset="seattle_spd_arrests",
                observed_at=datetime(2024, 1, 10, 14, 30, tzinfo=UTC),
                latitude=47.6092,
                longitude=-122.3335,
                subcategory="SHOPLIFTING",
            )
        )
        session.commit()

    response = client.post(
        "/dashboard/reports",
        json={
            "points": [
                {
                    "label": "Ad-hoc point",
                    "latitude": 47.609123,
                    "longitude": -122.333456,
                }
            ],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radius_m": 250,
            "layer": "arrests",
            "arrest_offense_description": "SHOPLIFTING",
        },
    )

    assert response.status_code == 200
    report = response.json()
    assert report["scope"]["filters"]["arrest_offense_description"] == "SHOPLIFTING"
    assert report["scope"]["filters"]["offense_subcategory"] is None
    record = report["sections"]["records"]["records"][0]
    assert record["arrest_offense_description"] == "SHOPLIFTING"
    assert record["offense_subcategory"] is None
    assert report["sections"]["comparison"] is None


def test_report_overlap_distinguishes_unique_records_from_place_memberships(tmp_path):
    _, client = _client(tmp_path, "overlap")
    first_id = _place(client, "First", 47.6090, -122.3330)
    second_id = _place(client, "Second", 47.6092, -122.3332)
    with get_sessionmaker()() as session:
        session.add(
            _incident(
                incident_id="reported-overlap",
                source_dataset="seattle_spd_crime",
                observed_at=datetime(2024, 1, 10, 8, 0, tzinfo=UTC),
                latitude=47.6091,
                longitude=-122.3331,
                subcategory="THEFT",
            )
        )
        session.commit()

    response = client.post(
        "/dashboard/reports",
        json=_reported_request([first_id, second_id]),
    )

    assert response.status_code == 200
    report = response.json()
    assert report["report_id"]
    assert report["selection_kind"] == "multi_place"
    assert report["comparison_mode"] == "modeled"
    assert report["sections"]["overview"]["unique_source_record_count"] == 1
    assert report["sections"]["overview"]["membership_count"] == 2
    assert [place["record_count"] for place in report["sections"]["place_context"]] == [1, 1]
    assert all(
        record["duplicate_across_places"] for record in report["sections"]["records"]["records"]
    )
    assert report["sections"]["comparison"]["method_family"] == ("candidate_vs_alternatives_bh")
    assert len(report["sections"]["comparison"]["pairwise_results"]) == 1

    user_hash = public_user_hash(client.cookies.get("mca_session"))
    assert user_hash is not None
    with get_sessionmaker()() as session:
        snapshot = session.get(AnalysisReportSnapshot, report["report_id"])
        assert snapshot is not None
        assert json.loads(snapshot.selected_place_ids_json) == [first_id, second_id]
        assert first_id not in snapshot.payload_json
        assert second_id not in snapshot.payload_json
        assert user_hash not in snapshot.payload_json


def test_saved_report_is_owned_revalidated_and_deletable(tmp_path):
    app, owner = _client(tmp_path, "ownership")
    place_id = _place(owner, "Saved", 47.6090, -122.3330)

    created = owner.post("/dashboard/reports", json=_reported_request([place_id]))
    assert created.status_code == 200
    report_id = created.json()["report_id"]
    assert report_id
    assert owner.get(f"/dashboard/reports/{report_id}").status_code == 200

    stranger = TestClient(app)
    assert stranger.post("/sessions").status_code == 200
    assert stranger.get(f"/dashboard/reports/{report_id}").status_code == 404
    assert stranger.delete(f"/dashboard/reports/{report_id}").status_code == 404

    with get_sessionmaker()() as session:
        place = session.get(PlaceCluster, place_id)
        assert place is not None
        place.sensitivity_class = "home_candidate"
        session.commit()
    blocked = owner.get(f"/dashboard/reports/{report_id}")
    assert blocked.status_code == 409
    assert "became sensitive" in blocked.json()["detail"]

    # Deletion remains available even when retrieval/export is privacy-blocked.
    assert owner.delete(f"/dashboard/reports/{report_id}").status_code == 204
    assert owner.get(f"/dashboard/reports/{report_id}").status_code == 404


def test_delete_all_reports_removes_only_the_current_owners_snapshots(tmp_path):
    app, owner = _client(tmp_path, "delete-all")
    owner_place = _place(owner, "Owner", 47.6090, -122.3330)
    owner_report = owner.post("/dashboard/reports", json=_reported_request([owner_place])).json()[
        "report_id"
    ]

    stranger = TestClient(app)
    stranger.post("/sessions")
    stranger_place = _place(stranger, "Stranger", 47.6120, -122.3350)
    stranger_report = stranger.post(
        "/dashboard/reports", json=_reported_request([stranger_place])
    ).json()["report_id"]

    response = owner.delete("/dashboard/reports")

    assert response.status_code == 200
    assert response.json() == {"deleted_count": 1}
    assert owner.get(f"/dashboard/reports/{owner_report}").status_code == 404
    assert stranger.get(f"/dashboard/reports/{stranger_report}").status_code == 200


def test_report_requires_explicit_available_date_adjustment(tmp_path):
    _, client = _client(tmp_path, "coverage")
    place_id = _place(client, "Coverage", 47.6090, -122.3330)
    request = {
        "place_ids": [place_id],
        "analysis_start_date": "2017-12-01",
        "analysis_end_date": "2018-01-31",
        "radius_m": 250,
        "layer": "reported",
    }

    required = client.post("/dashboard/reports", json=request)

    assert required.status_code == 409
    detail = required.json()["detail"]
    assert detail["code"] == "date_coverage_adjustment_required"
    assert detail["available_start_date"] == "2018-01-01"

    adjusted = client.post(
        "/dashboard/reports",
        json={**request, "adjust_to_available_dates": True},
    )
    assert adjusted.status_code == 200
    assert adjusted.json()["scope"]["requested_start_date"] == "2017-12-01"
    assert adjusted.json()["scope"]["effective_start_date"] == "2018-01-01"


def test_call_report_rejects_crime_only_filters(tmp_path):
    _, client = _client(tmp_path, "call-filter")

    response = client.post(
        "/dashboard/reports",
        json={
            "points": [{"label": "Point", "latitude": 47.609, "longitude": -122.333}],
            "analysis_start_date": "2026-07-01",
            "analysis_end_date": "2026-07-31",
            "radius_m": 250,
            "layer": "calls",
            "offense_category": "PROPERTY",
        },
    )

    assert response.status_code == 422
    assert "support call_type only" in response.text


def test_arrest_report_rejects_generic_storage_subcategory_filter(tmp_path):
    _, client = _client(tmp_path, "arrest-filter")

    response = client.post(
        "/dashboard/reports",
        json={
            "points": [{"label": "Point", "latitude": 47.609, "longitude": -122.333}],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radius_m": 250,
            "layer": "arrests",
            "offense_subcategory": "SHOPLIFTING",
        },
    )

    assert response.status_code == 422
    assert "use arrest_offense_description" in response.text


def test_report_contract_rejects_a_section_with_the_wrong_counting_unit(tmp_path):
    _, client = _client(tmp_path, "contract-consistency")
    response = client.post(
        "/dashboard/reports",
        json={
            "points": [{"label": "Point", "latitude": 47.609, "longitude": -122.333}],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2024-01-31",
            "radius_m": 250,
            "layer": "reported",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    payload["sections"]["records"]["counting_unit"] = "arrest_record"

    with pytest.raises(ValidationError, match="every report section"):
        AnalysisReport.model_validate(payload)

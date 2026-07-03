from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.assistant.schemas import AssistantDashboardState, SemanticContextPacket
from app.config import Settings
from app.models import PlaceCluster, PlaceCrimeSummary
from app.services.analysis_runs import latest_analysis_run_id
from app.services.dashboard_service import dashboard_summary

POLICY_CAVEATS = [
    "Waypoint describes reported incident context, not personal safety.",
    "Do not label places as safe or unsafe.",
    "Expected weekly visits are routine metadata, not a risk denominator.",
    (
        "Reported incident data can be incomplete, delayed, or filtered by the "
        "current analysis settings."
    ),
    (
        "The active layer (active_filters.layer) decides what the counts mean: 'reported' is "
        "SPD crime reports; 'arrests' is SPD arrest records — enforcement activity, not "
        "reported incidents (an arrest is logged where the arrest was made, which may differ "
        "from where an offense occurred, and most reported crimes never result in one); "
        "'calls' is 911 calls for service — requests, not confirmed incidents (one event can "
        "generate several calls, and many are proactive officer activity). Describe results "
        "using the active layer's terms."
    ),
]

AVAILABLE_TOOLS = [
    {
        "name": "add_place",
        "description": (
            "Find a place by name or address and save it. Pass the user's place "
            "name/address as 'query'."
        ),
    },
    {
        "name": "select_places",
        "description": (
            "Resolve place names to saved places (creating any missing) and set the "
            "current selection. Pass names as 'queries'; 'mode' is replace, add, or clear."
        ),
    },
    {
        "name": "analyze_places",
        "description": (
            "Resolve place names (or use the current selection), run the analysis for the "
            "active layer (reported incidents; arrests when layer is 'arrests'; 911 calls when "
            "layer is 'calls'), and return "
            "the neighborhood-vs-beat verdicts and incident details. Pass names as 'queries'."
        ),
    },
    {
        "name": "compare_places",
        "description": (
            "Resolve two or more place names (or use the selection), run the analysis, and "
            "compare their context for the active layer (reported incidents, arrests, or 911 "
            "calls). Pass names as 'queries'."
        ),
    },
    {
        "name": "get_dashboard_summary",
        "description": "Read current dashboard totals and saved places.",
    },
    {
        "name": "suggest_followups",
        "description": "Suggest deterministic follow-up questions.",
    },
]


def build_semantic_context(
    session: Session,
    user_id_hash: str,
    state: AssistantDashboardState,
    settings: Settings,
) -> SemanticContextPacket:
    summary = dashboard_summary(session, user_id_hash, settings)
    selected_ids = list(dict.fromkeys(state.selected_place_ids))
    selected_places = _selected_places(session, user_id_hash, selected_ids)
    crime_summaries = _crime_summaries(session, user_id_hash, selected_ids)
    return SemanticContextPacket(
        dashboard_totals={
            **summary["totals"],
            "available_radii_m": settings.crime_radii_m,
        },
        selected_places=[_place_payload(place) for place in selected_places],
        crime_summaries=[_summary_payload(row) for row in crime_summaries],
        active_filters={
            "selected_place_ids": selected_ids,
            "analysis_start_date": (
                state.analysis_start_date.isoformat() if state.analysis_start_date else None
            ),
            "analysis_end_date": (
                state.analysis_end_date.isoformat() if state.analysis_end_date else None
            ),
            "radii_m": state.radii_m,
            "offense_category": state.offense_category,
            "offense_subcategory": state.offense_subcategory,
            "nibrs_group": state.nibrs_group,
            "layer": state.layer,
        },
        available_tools=AVAILABLE_TOOLS,
        policy_caveats=POLICY_CAVEATS,
        missing_context=_missing_context(summary, selected_ids, selected_places, state),
    )


def _selected_places(
    session: Session,
    user_id_hash: str,
    selected_ids: list[str],
) -> list[PlaceCluster]:
    if not selected_ids:
        return []
    return list(
        session.scalars(
            select(PlaceCluster)
            .where(PlaceCluster.user_id_hash == user_id_hash)
            .where(PlaceCluster.id.in_(selected_ids))
            .order_by(PlaceCluster.visit_count.desc(), PlaceCluster.display_label.asc())
        )
    )


def _crime_summaries(
    session: Session,
    user_id_hash: str,
    selected_ids: list[str],
) -> list[PlaceCrimeSummary]:
    run_id = latest_analysis_run_id(session, user_id_hash)
    if run_id is None:
        return []
    statement = select(PlaceCrimeSummary).where(PlaceCrimeSummary.analysis_run_id == run_id)
    if selected_ids:
        statement = statement.where(PlaceCrimeSummary.place_cluster_id.in_(selected_ids))
    return list(session.scalars(statement.order_by(PlaceCrimeSummary.radius_m.asc())))


def _place_payload(place: PlaceCluster) -> dict[str, Any]:
    return {
        "id": place.id,
        "display_label": place.display_label,
        "latitude": place.display_latitude,
        "longitude": place.display_longitude,
        "visit_count": place.visit_count,
        "total_dwell_minutes": place.total_dwell_minutes,
        "median_dwell_minutes": place.median_dwell_minutes,
        "inferred_place_type": place.inferred_place_type,
        "sensitivity_class": place.sensitivity_class,
    }


def _summary_payload(summary: PlaceCrimeSummary) -> dict[str, Any]:
    return {
        "place_cluster_id": summary.place_cluster_id,
        "radius_m": summary.radius_m,
        "analysis_start_date": summary.analysis_start_date.isoformat(),
        "analysis_end_date": summary.analysis_end_date.isoformat(),
        "offense_category": summary.offense_category,
        "offense_subcategory": summary.offense_subcategory,
        "nibrs_group": summary.nibrs_group,
        "incident_count": summary.incident_count,
        "nearest_incident_m": (
            float(summary.nearest_incident_m)
            if summary.nearest_incident_m is not None
            else None
        ),
        "incidents_per_visit": (
            float(summary.incidents_per_visit)
            if summary.incidents_per_visit is not None
            else None
        ),
        "incidents_per_hour_dwell": (
            float(summary.incidents_per_hour_dwell)
            if summary.incidents_per_hour_dwell is not None
            else None
        ),
    }


def _missing_context(
    summary: dict[str, Any],
    selected_ids: list[str],
    selected_places: list[PlaceCluster],
    state: AssistantDashboardState,
) -> list[str]:
    missing: list[str] = []
    if summary["totals"]["place_count"] == 0:
        missing.append("No saved places are available.")
    if not selected_ids:
        missing.append("No places are selected.")
    elif len(selected_places) != len(selected_ids):
        missing.append("One or more selected places are unavailable in this public session.")
    if state.analysis_start_date is None or state.analysis_end_date is None:
        missing.append("No complete analysis date range is selected.")
    if not state.radii_m:
        missing.append("No analysis radius is selected.")
    return missing

from __future__ import annotations

from datetime import date
from functools import lru_cache
from typing import Any

from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.analysis.beat_baselines import (
    BeatPolygons,
    load_beat_areas,
    load_beat_polygons,
)
from app.api.dashboard_schemas import (
    DashboardAnalyzeRequest,
    DashboardIncidentDetailsRequest,
)
from app.assistant.place_resolution import ResolvedPlaces, resolve_place_queries
from app.config import get_settings
from app.geocoding.providers import build_provider
from app.models import PlaceCluster
from app.services.dashboard_analysis_service import (
    analyze_selected_places,
    compare_selected_places,
    incident_details_for_places,
)
from app.services.dashboard_service import dashboard_summary
from app.services.manual_place_service import _place_response
from app.services.neighborhood_service import neighborhood_analysis_for_places

AGENT_INCIDENT_LIMIT = 100


@lru_cache(maxsize=1)
def _beat_areas() -> dict[str, float]:
    return load_beat_areas()


@lru_cache(maxsize=1)
def _beat_polygons() -> BeatPolygons:
    return load_beat_polygons()


class AssistantToolError(ValueError):
    """Raised when an assistant tool request is invalid or cannot be executed."""


class EmptyArgs(BaseModel):
    pass


class AddPlaceArgs(BaseModel):
    query: str = Field(min_length=1)


class SelectPlacesArgs(BaseModel):
    queries: list[str] = Field(default_factory=list)
    mode: str = "replace"


class AnalyzePlacesArgs(BaseModel):
    queries: list[str] = Field(default_factory=list)
    place_ids: list[str] = Field(default_factory=list)
    analysis_start_date: date
    analysis_end_date: date
    radii_m: list[int] = Field(min_length=1)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


class ComparePlacesByNameArgs(BaseModel):
    queries: list[str] = Field(default_factory=list)
    place_ids: list[str] = Field(default_factory=list)
    analysis_start_date: date
    analysis_end_date: date
    radius_m: int = Field(gt=0, le=5000)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


def _select_places(
    session: Session, user_id_hash: str, queries: list[str], mode: str
) -> dict[str, Any]:
    normalized_mode = mode if mode in {"replace", "add", "clear"} else "replace"
    if normalized_mode == "clear":
        return {"place_ids": [], "mode": "clear", "matched": [], "created": [], "unresolved": []}
    provider = build_provider(get_settings())
    resolved = resolve_place_queries(session, user_id_hash, queries, provider)
    return {
        "place_ids": resolved.place_ids,
        "mode": normalized_mode,
        "matched": resolved.matched,
        "created": resolved.created,
        "unresolved": resolved.unresolved,
    }


def _add_place(session: Session, user_id_hash: str, query: str) -> dict[str, Any]:
    provider = build_provider(get_settings())
    resolved = resolve_place_queries(session, user_id_hash, [query], provider)
    if not resolved.place_ids:
        raise AssistantToolError(f"Could not find a place for '{query}'.")
    place_id = resolved.place_ids[0]
    place = session.get(PlaceCluster, place_id)
    if place is None:
        raise AssistantToolError(f"Place '{place_id}' was not found after resolution.")
    was_created = any(entry["place_id"] == place_id for entry in resolved.created)
    address = next(
        (entry["address"] for entry in resolved.created if entry["place_id"] == place_id),
        None,
    )
    return {
        "place": _place_response(place).model_dump(mode="json"),
        "place_id": place_id,
        "created": was_created,
        "address": address,
    }


def _resolve_or_select(
    session: Session,
    user_id_hash: str,
    queries: list[str],
    place_ids: list[str],
) -> ResolvedPlaces:
    """Prefer model-named queries; fall back to the backfilled selection ids."""
    if queries:
        provider = build_provider(get_settings())
        return resolve_place_queries(session, user_id_hash, queries, provider)
    return ResolvedPlaces(place_ids=list(place_ids))


def _settings_used(
    args: AnalyzePlacesArgs | ComparePlacesByNameArgs, radius_m: int
) -> dict[str, Any]:
    return {
        "radius_m": radius_m,
        "analysis_start_date": args.analysis_start_date.isoformat(),
        "analysis_end_date": args.analysis_end_date.isoformat(),
        "offense_category": args.offense_category,
        "offense_subcategory": args.offense_subcategory,
        "nibrs_group": args.nibrs_group,
    }


def _analyze_places(session: Session, user_id_hash: str, args: AnalyzePlacesArgs) -> dict[str, Any]:
    resolved = _resolve_or_select(session, user_id_hash, args.queries, args.place_ids)
    if not resolved.place_ids:
        raise AssistantToolError("Name a place to analyze, or select one on the dashboard.")
    radii = list(dict.fromkeys(args.radii_m))
    radius_m = radii[0]
    analysis = analyze_selected_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radii_m=radii,
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
    )
    neighborhood = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radius_m=radius_m,
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
        area_lookup=_beat_areas(),
        beat_polygons=_beat_polygons(),
    )
    incidents = incident_details_for_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radii_m=[radius_m],
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
        limit=AGENT_INCIDENT_LIMIT,
    )
    return {
        "place_ids": resolved.place_ids,
        "settings_used": _settings_used(args, radius_m),
        "analysis": analysis,
        "neighborhood": neighborhood,
        "incidents": incidents,
        "matched": resolved.matched,
        "created": resolved.created,
        "unresolved": resolved.unresolved,
    }


def _compare_places(
    session: Session, user_id_hash: str, args: ComparePlacesByNameArgs
) -> dict[str, Any]:
    resolved = _resolve_or_select(session, user_id_hash, args.queries, args.place_ids)
    if len(resolved.place_ids) < 2:
        raise AssistantToolError(
            "Name at least two places to compare, or select them on the dashboard."
        )
    # Persist an analysis run at this radius so the dashboard summary has rows for the cards.
    analyze_selected_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radii_m=[args.radius_m],
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
    )
    comparison = compare_selected_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radius_m=args.radius_m,
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
    )
    return {
        "place_ids": resolved.place_ids,
        "settings_used": _settings_used(args, args.radius_m),
        "comparison": comparison,
        "matched": resolved.matched,
        "created": resolved.created,
        "unresolved": resolved.unresolved,
    }


def execute_tool(
    session: Session,
    user_id_hash: str,
    tool_name: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    try:
        if tool_name == "get_dashboard_summary":
            EmptyArgs.model_validate(arguments)
            result = dashboard_summary(session, user_id_hash, get_settings())
            validated_arguments: dict[str, Any] = {}
        elif tool_name == "run_place_analysis":
            args = DashboardAnalyzeRequest.model_validate(arguments)
            result = analyze_selected_places(
                session=session,
                user_id_hash=user_id_hash,
                place_ids=args.place_ids,
                radii_m=args.radii_m,
                analysis_start_date=args.analysis_start_date,
                analysis_end_date=args.analysis_end_date,
                offense_category=args.offense_category,
                offense_subcategory=args.offense_subcategory,
                nibrs_group=args.nibrs_group,
            )
            validated_arguments = args.model_dump(mode="json")
        elif tool_name == "compare_places":
            args = ComparePlacesByNameArgs.model_validate(arguments)
            result = _compare_places(session, user_id_hash, args)
            validated_arguments = args.model_dump(mode="json")
        elif tool_name == "get_neighborhood_analysis":
            args = DashboardAnalyzeRequest.model_validate(arguments)
            result = neighborhood_analysis_for_places(
                session=session,
                user_id_hash=user_id_hash,
                place_ids=args.place_ids,
                radius_m=args.radii_m[0],
                analysis_start_date=args.analysis_start_date,
                analysis_end_date=args.analysis_end_date,
                offense_category=args.offense_category,
                offense_subcategory=args.offense_subcategory,
                nibrs_group=args.nibrs_group,
                area_lookup=_beat_areas(),
                beat_polygons=_beat_polygons(),
            )
            validated_arguments = args.model_dump(mode="json")
        elif tool_name == "get_incident_details":
            args = DashboardIncidentDetailsRequest.model_validate(arguments)
            capped_limit = min(args.limit, AGENT_INCIDENT_LIMIT)
            result = incident_details_for_places(
                session=session,
                user_id_hash=user_id_hash,
                place_ids=args.place_ids,
                radii_m=args.radii_m,
                analysis_start_date=args.analysis_start_date,
                analysis_end_date=args.analysis_end_date,
                offense_category=args.offense_category,
                offense_subcategory=args.offense_subcategory,
                nibrs_group=args.nibrs_group,
                limit=capped_limit,
            )
            validated_arguments = {
                **args.model_dump(mode="json"),
                "limit": capped_limit,
            }
        elif tool_name == "suggest_followups":
            EmptyArgs.model_validate(arguments)
            result = {"suggestions": _suggest_followups()}
            validated_arguments = {}
        elif tool_name == "add_place":
            args = AddPlaceArgs.model_validate(arguments)
            result = _add_place(session, user_id_hash, args.query)
            validated_arguments = args.model_dump(mode="json")
        elif tool_name == "select_places":
            args = SelectPlacesArgs.model_validate(arguments)
            result = _select_places(session, user_id_hash, args.queries, args.mode)
            validated_arguments = args.model_dump(mode="json")
        elif tool_name == "analyze_places":
            args = AnalyzePlacesArgs.model_validate(arguments)
            result = _analyze_places(session, user_id_hash, args)
            validated_arguments = args.model_dump(mode="json")
        else:
            raise AssistantToolError(f"Unknown assistant tool: {tool_name}")
    except ValidationError as exc:
        raise AssistantToolError(str(exc)) from exc
    except ValueError as exc:
        raise AssistantToolError(str(exc)) from exc

    return {
        "tool_name": tool_name,
        "arguments": validated_arguments,
        "result": result,
    }


def _suggest_followups() -> list[str]:
    return [
        "Compare the selected places for the current date range.",
        "Run the analysis again at a different radius.",
        "Show the reported incident details behind the current summary.",
        "Narrow the analysis by offense category or date range.",
    ]


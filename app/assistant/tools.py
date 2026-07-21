from __future__ import annotations

import json
from datetime import date
from functools import lru_cache
from hashlib import sha256
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError, model_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.analysis.area_baselines import load_mcpp_areas, load_mcpp_polygons
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
from app.crime.sources import sources_for_layer
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

# Tool results are echoed verbatim over the assistant SSE stream (the frontend bridge
# consumes them to populate the panes); 100 rows was ~50KB per turn — heavy over the
# demo tunnel. The UI already shows "Showing nearest N of M" when capped.
AGENT_INCIDENT_LIMIT = 30


@lru_cache(maxsize=1)
def _beat_areas() -> dict[str, float]:
    return load_beat_areas()


@lru_cache(maxsize=1)
def _beat_polygons() -> BeatPolygons:
    return load_beat_polygons()


@lru_cache(maxsize=1)
def _mcpp_areas() -> dict[str, float]:
    return load_mcpp_areas()


@lru_cache(maxsize=1)
def _mcpp_polygons() -> BeatPolygons:
    return load_mcpp_polygons()


class AssistantToolError(ValueError):
    """Raised when an assistant tool request is invalid or cannot be executed."""


class AssistantClarification(Exception):
    """The request is underspecified/ambiguous — ask the user, do not error.

    Deliberately NOT a ValueError, so execute_tool's `except ValueError`
    re-wrap does not swallow it; the agent renders it as a clarifying question.
    """


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
    # Optional so a missing date range / radius surfaces as a clarification (see
    # _require_analysis_window) instead of a raw ValidationError -> hard error.
    analysis_start_date: date | None = None
    analysis_end_date: date | None = None
    radii_m: list[int] = Field(default_factory=list)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    layer: str = "reported"


class ComparePlacesByNameArgs(BaseModel):
    queries: list[str] = Field(default_factory=list)
    place_ids: list[str] = Field(default_factory=list)
    # Optional so a missing window surfaces as a clarification, not a ValidationError.
    analysis_start_date: date | None = None
    analysis_end_date: date | None = None
    radius_m: int | None = Field(default=None, gt=0, le=5000)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    layer: str = "reported"


class UpdateFiltersArgs(BaseModel):
    radius_m: int | None = Field(default=None, ge=50, le=5000)
    analysis_start_date: date | None = None
    analysis_end_date: date | None = None
    # "" or "ALL" clears to all-reported (echoed as None, matching _settings_used).
    # ALL exists because the chat path (_tool_arguments) strips "" from arguments.
    offense_category: Literal["", "ALL", "PROPERTY", "PERSON", "SOCIETY"] | None = None
    layer: Literal["reported", "arrests", "calls"] | None = None

    @model_validator(mode="after")
    def _dates_ordered(self) -> UpdateFiltersArgs:
        if (
            self.analysis_start_date is not None
            and self.analysis_end_date is not None
            and self.analysis_start_date > self.analysis_end_date
        ):
            raise ValueError("start date must be on or before end date")
        return self


def _require_analysis_window(
    start: date | None, end: date | None, radius: list[int] | int | None
) -> None:
    """Clarify (don't hard-error) when the analysis window is incomplete.

    The dashboard backfills these from its current state; when nothing is set the args arrive
    empty. Raising AssistantClarification turns a raw ValidationError into a friendly question.
    """
    missing: list[str] = []
    if start is None:
        missing.append("a start date")
    if end is None:
        missing.append("an end date")
    if not radius:
        missing.append("a radius")
    if missing:
        raise AssistantClarification(
            "I need " + ", ".join(missing) + " to run that. Set the date range and radius on the "
            "dashboard (or include them in your request) and ask again."
        )


def _select_places(
    session: Session, user_id_hash: str, queries: list[str], mode: str
) -> dict[str, Any]:
    normalized_mode = mode if mode in {"replace", "add", "clear"} else "replace"
    if normalized_mode == "clear":
        return {"place_ids": [], "mode": "clear", "matched": [], "created": [], "unresolved": []}
    if not queries:
        raise AssistantClarification(
            "Name at least one place to select, or say 'clear all' to deselect everything."
        )
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
        raise AssistantClarification(
            f"Could not find a place for '{query}'. Try a more specific address or landmark name."
        )
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
    # Echo only the fields the frontend bridge (AnalysisSettings) can apply. The analysis still
    # honors offense_subcategory / nibrs_group as filters; they're omitted here because the UI
    # has no control for them, keeping settings_used 1:1 with what the bridge consumes.
    return {
        "radius_m": radius_m,
        "analysis_start_date": args.analysis_start_date.isoformat(),
        "analysis_end_date": args.analysis_end_date.isoformat(),
        "offense_category": args.offense_category,
        "layer": args.layer,
    }


def _badge_descriptors(
    session: Session,
    place_ids: list[str],
    run_id: str | None,
    settings_used: dict[str, Any],
) -> list[dict[str, Any]]:
    # Neutral presence descriptors: which places have current results, and from which
    # run/settings. Never carries verdict content (product invariant) — presence only.
    fingerprint = sha256(
        json.dumps(settings_used, sort_keys=True, default=str).encode()
    ).hexdigest()[:12]
    rows = session.execute(select(PlaceCluster).where(PlaceCluster.id.in_(place_ids))).scalars()
    labels = {row.id: row.display_label for row in rows}
    return [
        {
            "place_id": place_id,
            "label": labels.get(place_id, ""),
            "run_id": run_id,
            "settings_fingerprint": fingerprint,
        }
        for place_id in place_ids
    ]


def _analyze_places(session: Session, user_id_hash: str, args: AnalyzePlacesArgs) -> dict[str, Any]:
    resolved = _resolve_or_select(session, user_id_hash, args.queries, args.place_ids)
    if not resolved.place_ids:
        raise AssistantClarification("Name a place to analyze, or select one on the dashboard.")
    _require_analysis_window(args.analysis_start_date, args.analysis_end_date, args.radii_m)
    radii = list(dict.fromkeys(args.radii_m))
    radius_m = radii[0]
    sources = sources_for_layer(args.layer)
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
        sources=sources,
        layer=args.layer,
    )
    run_id = analysis.pop("analysis_run_id", None)
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
        mcpp_area_lookup=_mcpp_areas(),
        mcpp_polygons=_mcpp_polygons(),
        sources=sources,
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
        sources=sources,
    )
    settings_used = _settings_used(args, radius_m)
    return {
        "place_ids": resolved.place_ids,
        "settings_used": settings_used,
        "analysis": analysis,
        "neighborhood": neighborhood,
        "incidents": incidents,
        "matched": resolved.matched,
        "created": resolved.created,
        "unresolved": resolved.unresolved,
        "analysis_run_id": run_id,
        "badges": _badge_descriptors(session, resolved.place_ids, run_id, settings_used),
    }


def _compare_places(
    session: Session, user_id_hash: str, args: ComparePlacesByNameArgs
) -> dict[str, Any]:
    resolved = _resolve_or_select(session, user_id_hash, args.queries, args.place_ids)
    if len(resolved.place_ids) < 2:
        raise AssistantClarification(
            "Name at least two places to compare, or select them on the dashboard."
        )
    _require_analysis_window(args.analysis_start_date, args.analysis_end_date, args.radius_m)
    sources = sources_for_layer(args.layer)
    # Persist an analysis run at this radius so the dashboard summary has rows for the cards.
    analysis = analyze_selected_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radii_m=[args.radius_m],
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
        sources=sources,
        layer=args.layer,
    )
    # Use the exact analyze run, not a post-commit "latest" lookup that can race a
    # concurrent request for the same session.
    run_id = analysis.pop("analysis_run_id", None)
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
        sources=sources,
    )
    neighborhood = neighborhood_analysis_for_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radius_m=args.radius_m,
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
        area_lookup=_beat_areas(),
        beat_polygons=_beat_polygons(),
        mcpp_area_lookup=_mcpp_areas(),
        mcpp_polygons=_mcpp_polygons(),
        sources=sources,
    )
    incidents = incident_details_for_places(
        session=session,
        user_id_hash=user_id_hash,
        place_ids=resolved.place_ids,
        radii_m=[args.radius_m],
        analysis_start_date=args.analysis_start_date,
        analysis_end_date=args.analysis_end_date,
        offense_category=args.offense_category,
        offense_subcategory=args.offense_subcategory,
        nibrs_group=args.nibrs_group,
        limit=AGENT_INCIDENT_LIMIT,
        sources=sources,
    )
    settings_used = _settings_used(args, args.radius_m)
    return {
        "place_ids": resolved.place_ids,
        "settings_used": settings_used,
        "comparison": comparison,
        "neighborhood": neighborhood,
        "incidents": incidents,
        "matched": resolved.matched,
        "created": resolved.created,
        "unresolved": resolved.unresolved,
        "analysis_run_id": run_id,
        "badges": _badge_descriptors(session, resolved.place_ids, run_id, settings_used),
    }


def _update_filters(args: UpdateFiltersArgs) -> dict[str, Any]:
    patch: dict[str, Any] = {}
    if args.radius_m is not None:
        patch["radius_m"] = args.radius_m
    if args.analysis_start_date is not None:
        patch["analysis_start_date"] = args.analysis_start_date.isoformat()
    if args.analysis_end_date is not None:
        patch["analysis_end_date"] = args.analysis_end_date.isoformat()
    if args.offense_category is not None:
        patch["offense_category"] = (
            args.offense_category
            if args.offense_category in ("PROPERTY", "PERSON", "SOCIETY")
            else None
        )
    if args.layer is not None:
        patch["layer"] = args.layer
    if not patch:
        raise AssistantClarification(
            "Tell me which filter to change — radius, dates, categories, or layer."
        )
    return {"patch": patch}


def execute_tool(
    session: Session,
    user_id_hash: str,
    tool_name: str,
    arguments: dict[str, Any],
) -> dict[str, Any]:
    # The agent-advertised menu (semantic_layer.AVAILABLE_TOOLS) is the seven PoC tools.
    # The run_place_analysis / get_neighborhood_analysis / get_incident_details branches below
    # are intentionally retained-but-unadvertised: analyze_places folds them in for the agent,
    # while the granular branches stay callable for existing tests and non-agent paths.
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
                sources=sources_for_layer(args.layer),
                layer=args.layer,
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
                mcpp_area_lookup=_mcpp_areas(),
                mcpp_polygons=_mcpp_polygons(),
                sources=sources_for_layer(args.layer),
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
                sources=sources_for_layer(args.layer),
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
        elif tool_name == "update_filters":
            args = UpdateFiltersArgs.model_validate(arguments)
            result = _update_filters(args)
            validated_arguments = args.model_dump(mode="json")
        else:
            raise AssistantToolError(f"Unknown assistant tool: {tool_name}")
    except AssistantToolError:
        raise
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

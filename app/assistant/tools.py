from __future__ import annotations

from datetime import date
from typing import Any

from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.dashboard_analysis_service import (
    analyze_selected_places,
    compare_selected_places,
    incident_details_for_places,
)
from app.services.dashboard_service import dashboard_summary

AGENT_INCIDENT_LIMIT = 100
MAX_RADIUS_M = 5000


class AssistantToolError(ValueError):
    """Raised when an assistant tool request is invalid or cannot be executed."""


class EmptyArgs(BaseModel):
    pass


class PlaceAnalysisArgs(BaseModel):
    place_ids: list[str] = Field(min_length=1)
    analysis_start_date: date
    analysis_end_date: date
    radii_m: list[int] = Field(min_length=1)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None

    @field_validator("radii_m")
    @classmethod
    def radii_m_must_be_valid(cls, value: list[int]) -> list[int]:
        return _validate_radii(value)


class ComparePlacesArgs(BaseModel):
    place_ids: list[str] = Field(min_length=2)
    analysis_start_date: date
    analysis_end_date: date
    radius_m: int = Field(gt=0, le=MAX_RADIUS_M)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None


class IncidentDetailsArgs(PlaceAnalysisArgs):
    limit: int = Field(default=AGENT_INCIDENT_LIMIT, ge=1, le=500)


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
            args = PlaceAnalysisArgs.model_validate(arguments)
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
            args = ComparePlacesArgs.model_validate(arguments)
            result = compare_selected_places(
                session=session,
                user_id_hash=user_id_hash,
                place_ids=args.place_ids,
                radius_m=args.radius_m,
                analysis_start_date=args.analysis_start_date,
                analysis_end_date=args.analysis_end_date,
                offense_category=args.offense_category,
                offense_subcategory=args.offense_subcategory,
                nibrs_group=args.nibrs_group,
            )
            validated_arguments = args.model_dump(mode="json")
        elif tool_name == "get_incident_details":
            args = IncidentDetailsArgs.model_validate(arguments)
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


def _validate_radii(value: list[int]) -> list[int]:
    if len(value) != len(set(value)):
        raise ValueError("radii_m values must be unique")
    for radius_m in value:
        if radius_m <= 0 or radius_m > MAX_RADIUS_M:
            raise ValueError(f"radius must be between 1 and {MAX_RADIUS_M} meters")
    return value


def _suggest_followups() -> list[str]:
    return [
        "Compare the selected places for the current date range.",
        "Run the analysis again at a different radius.",
        "Show the reported incident details behind the current summary.",
        "Narrow the analysis by offense category or date range.",
    ]


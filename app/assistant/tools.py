from __future__ import annotations

from functools import lru_cache
from typing import Any

from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.analysis.beat_baselines import load_beat_areas
from app.api.dashboard_schemas import (
    DashboardAnalyzeRequest,
    DashboardCompareRequest,
    DashboardIncidentDetailsRequest,
)
from app.config import get_settings
from app.services.dashboard_analysis_service import (
    analyze_selected_places,
    compare_selected_places,
    incident_details_for_places,
)
from app.services.dashboard_service import dashboard_summary
from app.services.neighborhood_service import neighborhood_analysis_for_places

AGENT_INCIDENT_LIMIT = 100


@lru_cache(maxsize=1)
def _beat_areas() -> dict[str, float]:
    return load_beat_areas()


class AssistantToolError(ValueError):
    """Raised when an assistant tool request is invalid or cannot be executed."""


class EmptyArgs(BaseModel):
    pass


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
            args = DashboardCompareRequest.model_validate(arguments)
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


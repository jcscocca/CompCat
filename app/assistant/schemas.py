from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field


class AssistantChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1)


class AssistantDashboardState(BaseModel):
    selected_place_ids: list[str] = Field(default_factory=list)
    analysis_start_date: date | None = None
    analysis_end_date: date | None = None
    radii_m: list[int] = Field(default_factory=list)
    offense_category: str | None = None
    offense_subcategory: str | None = None
    nibrs_group: str | None = None
    # Active analysis layer ("reported" = SPD crime reports, "arrests" = SPD arrest
    # records (enforcement activity), "calls" = 911 calls for service).
    layer: str = "reported"


class SemanticContextPacket(BaseModel):
    dashboard_totals: dict[str, Any]
    selected_places: list[dict[str, Any]]
    crime_summaries: list[dict[str, Any]]
    active_filters: dict[str, Any]
    available_tools: list[dict[str, Any]]
    policy_caveats: list[str]
    missing_context: list[str]


class AssistantChatRequest(BaseModel):
    messages: list[AssistantChatMessage] = Field(min_length=1)
    dashboard_state: AssistantDashboardState = Field(default_factory=AssistantDashboardState)


class AssistantStreamEvent(BaseModel):
    event: Literal["meta", "tool", "token", "done", "error"]
    data: dict[str, Any]


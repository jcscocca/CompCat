from __future__ import annotations

import logging
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

# Abuse ceilings on the assistant request. The endpoint is session-gated, but sessions are
# free and anonymous, so the payload itself is bounded to keep one caller from stuffing the
# shared LLM node with an oversized prompt. The model only ever reads the last 8 turns
# (prompts.build_planning_messages), so the message-count cap is a generous ceiling on a
# growing conversation, not a functional history limit.
MAX_MESSAGE_CHARS = 4000
MAX_MESSAGES_PER_REQUEST = 200


class AssistantChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


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
    layer: Literal["reported", "arrests", "calls"] = "reported"

    @field_validator("layer", mode="before")
    @classmethod
    def _known_layer(cls, value: Any) -> Any:
        """Fall back to "reported" rather than 422 on an unrecognized layer.

        The layer decides what every count MEANS, so an unknown value must not reach the
        tools — but a bad layer is a client bug, and rejecting the request would take the
        whole chat turn down with it. Degrade to the default (as _select_places does for
        an unknown mode) and note it server-side.
        """
        if value in ("reported", "arrests", "calls"):
            return value
        if value is not None:
            logger.warning("assistant dashboard_state carried an unknown layer %r", value)
        return "reported"


class SemanticContextPacket(BaseModel):
    dashboard_totals: dict[str, Any]
    selected_places: list[dict[str, Any]]
    crime_summaries: list[dict[str, Any]]
    active_filters: dict[str, Any]
    available_tools: list[dict[str, Any]]
    policy_caveats: list[str]
    missing_context: list[str]


class AssistantChatRequest(BaseModel):
    messages: list[AssistantChatMessage] = Field(
        min_length=1, max_length=MAX_MESSAGES_PER_REQUEST
    )
    dashboard_state: AssistantDashboardState = Field(default_factory=AssistantDashboardState)


class AssistantCommandRequest(BaseModel):
    # The fixed command enum IS the security boundary: pydantic 422s anything else,
    # so unadvertised tool handlers stay unreachable from the client.
    command: Literal[
        "analyze_places",
        "compare_places",
        "add_place",
        "select_places",
        "update_filters",
        "suggest_followups",
    ]
    arguments: dict[str, Any] = Field(default_factory=dict)


class AssistantStreamEvent(BaseModel):
    event: Literal["meta", "tool", "token", "status", "replace", "done", "error"]
    data: dict[str, Any]


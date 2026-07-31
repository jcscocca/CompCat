from __future__ import annotations

import logging
from datetime import date
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

logger = logging.getLogger(__name__)

# Abuse ceilings on the assistant request. The endpoint is session-gated, but sessions are
# free and anonymous, so the payload itself is bounded to keep one caller from stuffing the
# shared LLM node with an oversized prompt. The model only ever reads the last 8 turns
# (prompts.build_planning_messages), so the message-count cap is a generous ceiling on a
# growing conversation, not a functional history limit.
MAX_MESSAGE_CHARS = 4000
MAX_MESSAGES_PER_REQUEST = 200

# The same ceilings applied to dashboard_state. It is interpolated verbatim into the planning
# prompt (semantic_layer.active_filters), so leaving it unbounded let a caller send megabytes
# upstream while every *message* stayed under MAX_MESSAGE_CHARS — the payload cap without the
# payload. The place-id list is also the .in_() argument in semantic_layer._selected_places,
# where an unbounded list overflows SQL bind parameters.
MAX_SELECTED_PLACES = 25  # the UI tops out at 10 saved places plus ad-hoc pins
MAX_PLACE_ID_CHARS = 64  # ids are uuids (36)
MAX_RADII = 3  # Settings.crime_radii_m only ever offers three
MAX_FILTER_CHARS = 80


class AssistantChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=MAX_MESSAGE_CHARS)


class AssistantDashboardState(BaseModel):
    selected_place_ids: list[Annotated[str, Field(max_length=MAX_PLACE_ID_CHARS)]] = Field(
        default_factory=list, max_length=MAX_SELECTED_PLACES
    )
    analysis_start_date: date | None = None
    analysis_end_date: date | None = None
    radii_m: list[Annotated[int, Field(gt=0, le=5000)]] = Field(
        default_factory=list, max_length=MAX_RADII
    )
    offense_category: str | None = Field(default=None, max_length=MAX_FILTER_CHARS)
    offense_subcategory: str | None = Field(default=None, max_length=MAX_FILTER_CHARS)
    nibrs_group: str | None = Field(default=None, max_length=MAX_FILTER_CHARS)
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
            rendered = str(value)[:MAX_FILTER_CHARS]
            logger.warning("assistant dashboard_state carried an unknown layer %r", rendered)
        return "reported"


class AssistantResultContext(BaseModel):
    """Compact scope for the newest frozen analysis card.

    The client deliberately sends only the identifiers and analysis settings needed to
    reproduce the result. Raw incident rows and client-authored statistical claims never
    become planning context; ``explain_result`` recomputes the authoritative data server-side.
    """

    kind: Literal["analyze", "compare"]
    place_ids: list[Annotated[str, Field(max_length=MAX_PLACE_ID_CHARS)]] = Field(
        min_length=1, max_length=MAX_SELECTED_PLACES
    )
    analysis_start_date: date
    analysis_end_date: date
    radius_m: int = Field(gt=0, le=5000)
    offense_category: str | None = Field(default=None, max_length=MAX_FILTER_CHARS)
    offense_subcategory: str | None = Field(default=None, max_length=MAX_FILTER_CHARS)
    nibrs_group: str | None = Field(default=None, max_length=MAX_FILTER_CHARS)
    layer: Literal["reported", "arrests", "calls"] = "reported"

    @model_validator(mode="after")
    def _valid_scope(self) -> AssistantResultContext:
        if self.analysis_end_date < self.analysis_start_date:
            raise ValueError("analysis_end_date must be on or after analysis_start_date")
        if self.kind == "compare" and len(set(self.place_ids)) < 2:
            raise ValueError("compare result context requires at least two places")
        return self


class SemanticContextPacket(BaseModel):
    dashboard_totals: dict[str, Any]
    selected_places: list[dict[str, Any]]
    crime_summaries: list[dict[str, Any]]
    active_filters: dict[str, Any]
    available_tools: list[dict[str, Any]]
    policy_caveats: list[str]
    missing_context: list[str]
    latest_result_context: dict[str, Any] | None = None


class AssistantChatRequest(BaseModel):
    messages: list[AssistantChatMessage] = Field(
        min_length=1, max_length=MAX_MESSAGES_PER_REQUEST
    )
    dashboard_state: AssistantDashboardState = Field(default_factory=AssistantDashboardState)
    latest_result_context: AssistantResultContext | None = None


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

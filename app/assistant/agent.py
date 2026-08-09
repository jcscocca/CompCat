from __future__ import annotations

import contextlib
import json
import re
from calendar import monthrange
from collections.abc import AsyncIterator, Callable
from datetime import date, timedelta
from typing import Any

from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.assistant.llm_client import (
    AssistantLlmClient,
    LlmRateLimited,
    LlmStreamInterrupted,
    LlmUnavailable,
)
from app.assistant.output_guard import (
    AMBIGUOUS_TERM_PATTERN,
    OUTPUT_RANKING_PROSE_PATTERN,
    PLACE_CONTEXT_PATTERN,
    PRESENCE_CLAIM_PATTERN,
    PRESENCE_REDIRECT,
    PRESENCE_REDIRECT_ES,
    REDIRECTS,
    SAFETY_REDIRECT,
    SAFETY_REDIRECT_ES,
    UNAMBIGUOUS_SAFETY_PATTERN,
    claims_user_presence,
    contains_safety_ranking,
    is_spanish,
    localized,
    output_guard_redirect,
    ranks_places,
)
from app.assistant.prompts import (
    PLANNING_RESPONSE_FORMAT,
    build_narration_messages,
    build_planning_messages,
    build_tool_grounding,
)
from app.assistant.schemas import (
    AssistantChatMessage,
    AssistantDashboardState,
    AssistantResultContext,
    AssistantStreamEvent,
)
from app.assistant.semantic_layer import build_semantic_context
from app.assistant.stream_guard import StreamGuardTripped, guarded_stream
from app.assistant.summaries import build_tool_summary
from app.assistant.tools import AssistantClarification, AssistantToolError, execute_tool
from app.config import get_settings
from app.ratelimit import get_rate_limiter

# The product-invariant guard (safety-ranking, place-ranking prose, presence claims) lives in
# app/assistant/output_guard.py so the deterministic tool summaries can apply it too. The
# underscore names below are kept as aliases: they are the historical import surface.
_UNAMBIGUOUS_SAFETY_PATTERN = UNAMBIGUOUS_SAFETY_PATTERN
_AMBIGUOUS_TERM_PATTERN = AMBIGUOUS_TERM_PATTERN
_PLACE_CONTEXT_PATTERN = PLACE_CONTEXT_PATTERN
# Back-compat alias — downstream imports (and the output-guard test) still work.
_SAFETY_SCORE_PATTERN = UNAMBIGUOUS_SAFETY_PATTERN
_SAFETY_REDIRECT = SAFETY_REDIRECT
_SAFETY_REDIRECT_ES = SAFETY_REDIRECT_ES
_PRESENCE_CLAIM_PATTERN = PRESENCE_CLAIM_PATTERN
_PRESENCE_REDIRECT = PRESENCE_REDIRECT
_PRESENCE_REDIRECT_ES = PRESENCE_REDIRECT_ES
_OUTPUT_RANKING_PROSE_PATTERN = OUTPUT_RANKING_PROSE_PATTERN
_contains_safety_ranking = contains_safety_ranking
_claims_user_presence = claims_user_presence
_output_ranks_places = ranks_places
_output_guard_redirect = output_guard_redirect

SELECTION_TOOLS = (
    "run_place_analysis",
    "compare_places",
    "get_neighborhood_analysis",
    "get_incident_details",
    "analyze_places",
)
_UNREACHABLE_MESSAGE = (
    "Couldn't reach the analyst to interpret your request. The rest of CompCat still works."
)
_RATE_LIMITED_MESSAGE = (
    "Tabby's model provider is at its short-term limit. Wait about a minute and try again — "
    "chips, filters, and the rest of CompCat still work."
)
# A syntactically valid plan whose shape we don't recognize (e.g. a small local model emits
# {"type": "clarify"}) is a soft failure, not an internal error: ask the user to rephrase.
_CLARIFY_FALLBACK = (
    "I didn't quite catch what you'd like me to look at — could you rephrase that? "
    "You can ask me to analyze a place, compare a few addresses, or adjust the filters."
)
_PRODUCT_SCOPE_ANSWER = (
    "From the case desk: reported incident context means CompCat describes patterns in "
    "Seattle Police records around a place — counts, categories, timing, and geographic "
    "comparisons within the filters you chose. It is context about reported records, not a "
    "judgment about a place or a claim that anyone was present."
)
_MISSING_SELECTION_CLARIFICATION = (
    "Select a map pin or name a Seattle place first, and I'll examine its reported incident "
    "context using your current filters."
)
_NARRATION_TEMPERATURE = 0.4
_NARRATION_MAX_TOKENS = 512
_STATUS_INTERPRETING = "interpreting your request…"
_STATUS_WRITING = "writing up…"
_CLEAR_NEW_REQUEST_PATTERN = re.compile(
    r"""
    ^\s*(?:
        (?:show|list|count|analy[sz]e|compare|explain|summari[sz]e|rerun|run)\b
        [^.?!]{0,80}
        \b(?:incident|report|arrest|call|count|categor|tim|filter|radius|date|layer)\w*
      | (?:change|set|update|adjust|clear)\b[^.?!]{0,80}
        \b(?:filter|radius|date|layer|offense|categor|selection)\w*
      | (?:add|save|select|find)\b[^.?!]{0,80}
        \b(?:place|address|pin|selection)\w*
      | (?:what|which|did|how\s+many|when|where)\b[^.?!]{0,80}
        \b(?:incident|report|arrest|call|count|categor|tim|filter|radius|date|layer)\w*
      | (?:muestra|lista|cuenta|analiza|compara|explica|resume|ejecuta)\b
        [^.?!]{0,80}
        \b(?:incidente|reporte|arresto|llamada|conteo|categor[ií]a|hora|filtro
           |radio|fecha|capa)s?\b
      | (?:cambia|ajusta|actualiza|borra)\b[^.?!]{0,80}
        \b(?:filtro|radio|fecha|capa|delito|categor[ií]a|selecci[oó]n)s?\b
      | (?:agrega|guarda|selecciona|busca)\b[^.?!]{0,80}
        \b(?:lugar|direcci[oó]n|marcador|selecci[oó]n)s?\b
      | (?:qu[eé]|cu[aá]nt[oa]s?|cu[aá]ndo|d[oó]nde)\b[^.?!]{0,80}
        \b(?:incidente|reporte|arresto|llamada|conteo|categor[ií]a|hora|filtro
           |radio|fecha|capa)s?\b
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)

# A clearly result-referential follow-up can skip planning without guessing scope:
# explain_result accepts no model-authored scope and recomputes the newest typed card context
# server-side. This is deliberately narrower than a general intent classifier so an unrelated
# request never gets silently turned into an explanation of an older card.
_RESULT_FOLLOWUP_PATTERN = re.compile(
    r"\b(?:this|that|current|latest|previous|last)\s+"
    r"(?:result|comparison|analysis|card|finding|verdict)\b"
    r"|\bwhat\s+does\s+(?:this|that|it)\s+mean\b"
    r"|\b(?:explain|summari[sz]e)\s+(?:this|that|the\s+)?"
    r"(?:result|comparison|analysis|finding|verdict)\b"
    r"|\b(?:which|what)\s+(?:offen[cs]e\s+)?categor(?:y|ies)\b"
    r"[^.?!]{0,80}\b(?:difference|comparison|result)\b"
    r"|\baccount(?:s|ed|ing)?\s+for\b[^.?!]{0,60}\b(?:difference|result)\b",
    re.IGNORECASE,
)

# Two common requests have complete, application-owned answers and should not depend on the
# planner. Keep these recognizers deliberately narrow: named-place analysis and general product
# questions still go through normal planning.
_PRODUCT_SCOPE_PATTERN = re.compile(
    r"^\s*(?:what\s+(?:does|is)|define|explain)\s+(?:the\s+)?"
    r"reported\s+incident\s+context(?:\s+mean)?"
    r"(?:\s+(?:in|on)\s+compcat)?\s*[?!.]*\s*$",
    re.IGNORECASE,
)
_ANALYSIS_INTENT_PATTERN = re.compile(
    r"\b(?:analy[sz]e|compare|examine|summari[sz]e|show|look)\b",
    re.IGNORECASE,
)
_SELECTION_REFERENCE_PATTERN = re.compile(
    r"\b(?:my|the|this|that|current)\s+"
    r"(?:(?:selected|saved)\s+)?(?:place|places|selection|pin|pins)\b"
    r"|\bhere\b",
    re.IGNORECASE,
)

# Shared daily LLM token budget exhausted. Fixed copy, invariant-safe: it speaks only about the
# request budget — never about places, addresses, or safety.
_BUDGET_EXHAUSTED_MESSAGE = (
    "Tabby's used up today's analysis budget. Free-text chat returns tomorrow — "
    "chips, filters, and analysis still work."
)


def _budget_exhausted(settings) -> bool:
    """True when today's shared token budget is spent. Enforcement rides the rate limiter
    (MCA_RATE_LIMIT_ENABLED); an unset/zero budget disables it entirely."""
    if not settings.rate_limit_enabled:
        return False
    return get_rate_limiter().budget_exceeded(limit=settings.assistant_token_budget_per_day)


def _budget_error_event() -> AssistantStreamEvent:
    return AssistantStreamEvent(
        event="error",
        data={"message": _BUDGET_EXHAUSTED_MESSAGE, "code": "budget_exhausted"},
    )


async def run_assistant_turn(
    session: Session,
    user_id_hash: str,
    messages: list[AssistantChatMessage],
    dashboard_state: AssistantDashboardState,
    llm_client: AssistantLlmClient,
    latest_result_context: AssistantResultContext | None = None,
) -> AsyncIterator[AssistantStreamEvent]:
    settings = get_settings()
    # run_assistant_turn iterates on the event loop; the semantic context does sync DB
    # work and execute_tool below can geocode (sync httpx + rate-gate sleep) — both must
    # run in the threadpool or one slow turn stalls every request in the process.
    context = await run_in_threadpool(
        build_semantic_context,
        session,
        user_id_hash,
        dashboard_state,
        settings,
        latest_result_context,
    )
    yield AssistantStreamEvent(
        event="meta",
        data={"role": settings.assistant_role, "missing_context": context.missing_context},
    )

    recent_user_texts = _recent_user_texts(messages)
    guard_user_texts = _guard_user_texts(messages)
    # A refusal in the wrong language reads as a failure to understand rather than a
    # deliberate limit. The guard already covers Spanish asks, so answer them in Spanish.
    spanish = any(is_spanish(text) for text in recent_user_texts)

    def guard(text: str) -> str | None:
        return localized(output_guard_redirect(text), spanish)

    if any(contains_safety_ranking(text) for text in guard_user_texts):
        yield AssistantStreamEvent(
            event="token", data={"delta": localized(SAFETY_REDIRECT, spanish)}
        )
        yield AssistantStreamEvent(event="done", data={})
        return
    if any(claims_user_presence(text) for text in guard_user_texts):
        yield AssistantStreamEvent(
            event="token", data={"delta": localized(PRESENCE_REDIRECT, spanish)}
        )
        yield AssistantStreamEvent(event="done", data={})
        return

    newest_user_text = recent_user_texts[-1] if recent_user_texts else ""
    if _PRODUCT_SCOPE_PATTERN.fullmatch(newest_user_text):
        yield AssistantStreamEvent(event="token", data={"delta": _PRODUCT_SCOPE_ANSWER})
        yield AssistantStreamEvent(event="done", data={})
        return
    if (
        not context.selected_places
        and _ANALYSIS_INTENT_PATTERN.search(newest_user_text)
        and _SELECTION_REFERENCE_PATTERN.search(newest_user_text)
    ):
        yield AssistantStreamEvent(
            event="token", data={"delta": _MISSING_SELECTION_CLARIFICATION}
        )
        yield AssistantStreamEvent(event="done", data={})
        return

    # Budget checkpoint 1 of 2: refuse before the planning call, so an exhausted day makes no
    # upstream request at all. Placed before the status event so the UI gets no dangling spinner.
    if _budget_exhausted(settings):
        yield _budget_error_event()
        return

    narrate = settings.assistant_narration_enabled
    if narrate:
        yield AssistantStreamEvent(event="status", data={"label": _STATUS_INTERPRETING})

    # End the read txn opened by build_semantic_context before the long planning await —
    # planning needs no DB, and holding it idle-in-transaction across the LLM latency would
    # pin a pooled connection (and block vacuum) on Postgres for every in-flight chat. The
    # session auto-begins a fresh txn when execute_tool queries below. Mirrors the two
    # narration-await rollbacks further down.
    session.rollback()

    if latest_result_context is not None and _RESULT_FOLLOWUP_PATTERN.search(newest_user_text):
        # This scope is entirely application-authored, so a clearly referential follow-up
        # needs no model judgement. Skipping local planning removes its slowest/frailiest call;
        # the normal narrated tool path below still supplies Tabby's voice, with the verified
        # deterministic summary as its fallback.
        plan: dict[str, Any] = {
            "type": "tool_call",
            "tool_name": "explain_result",
            "arguments": {},
            "context": "latest_result",
        }
    else:
        try:
            raw_plan = await _complete_plan(
                llm_client,
                build_planning_messages(messages, context),
                settings.assistant_role,
            )
            plan = _parse_model_json(raw_plan)
        except LlmRateLimited:
            yield AssistantStreamEvent(
                event="error",
                data={"message": _RATE_LIMITED_MESSAGE, "code": "llm_rate_limited"},
            )
            return
        except LlmUnavailable:
            yield AssistantStreamEvent(
                event="error",
                data={"message": _UNREACHABLE_MESSAGE, "code": "llm_unreachable"},
            )
            return
        except ValueError as exc:
            yield AssistantStreamEvent(
                event="error", data={"message": str(exc), "code": "internal"}
            )
            return

    if plan.get("type") == "tool_call":
        tool_name = str(plan.get("tool_name"))
        try:
            tool_result = await run_in_threadpool(
                execute_tool,
                session,
                user_id_hash,
                tool_name,
                _tool_arguments(
                    tool_name,
                    dashboard_state,
                    plan.get("arguments"),
                    recent_user_texts[-1] if recent_user_texts else "",
                    latest_result_context=latest_result_context,
                    use_latest_result=plan.get("context") == "latest_result",
                ),
            )
        except AssistantClarification as exc:
            clarification = str(exc)
            yield AssistantStreamEvent(
                event="token", data={"delta": guard(clarification) or clarification}
            )
            yield AssistantStreamEvent(event="done", data={})
            return
        except (AssistantToolError, ValueError) as exc:
            yield AssistantStreamEvent(
                event="error", data={"message": str(exc), "code": "tool_error"}
            )
            return
        # Emitted only once the tool has actually produced a result: a plan that clarifies
        # (or names a tool that does not exist) runs nothing, and a "running analyze_places…"
        # spinner in front of a clarifying question claims work that never happened.
        if narrate:
            yield AssistantStreamEvent(
                event="status", data={"label": f"running {tool_name}…"}
            )
        yield AssistantStreamEvent(event="tool", data=tool_result)
        # build_tool_summary already applied the output guard, so `summary` is either the
        # neutral one-liner or a redirect. A redirect must not be narrated (same rule as a
        # violating draft answer below): emit it and stop.
        summary = localized(build_tool_summary(tool_result), spanish)
        if not narrate or summary in REDIRECTS:
            yield AssistantStreamEvent(event="token", data={"delta": summary})
            yield AssistantStreamEvent(event="done", data={})
            return
        if _budget_exhausted(settings):
            yield _budget_error_event()
            return
        yield AssistantStreamEvent(event="status", data={"label": _STATUS_WRITING})
        grounding = build_tool_grounding(tool_name, summary, tool_result)
        # End the read txn before the long narration await — narration needs no DB.
        session.rollback()
        async with contextlib.aclosing(
            _stream_final(
                llm_client,
                build_narration_messages(messages, grounding),
                summary,
                settings.assistant_role,
                guard,
            )
        ) as final_events:
            async for event in final_events:
                yield event
        return

    try:
        message = _final_message(plan)
    except ValueError:
        # Unrecognized/empty plan shape: degrade to a gentle clarification instead of a hard
        # "internal" error the UI renders as a failure. Streams as a normal answer.
        yield AssistantStreamEvent(event="token", data={"delta": _CLARIFY_FALLBACK})
        yield AssistantStreamEvent(event="done", data={})
        return
    # Output-side invariant guard: a model answer that slipped past the input guard must not
    # stream safety-ranking language, place-ranking/livability prose, or a claim that the user
    # was present at an incident; replace it with the matching redirect.
    redirect = guard(message)
    if not narrate or redirect is not None:
        # Kill switch, or the draft itself violates: emit the (guarded) text at once —
        # never hand a violating draft to the narrator.
        yield AssistantStreamEvent(event="token", data={"delta": redirect or message})
        yield AssistantStreamEvent(event="done", data={})
        return
    if _budget_exhausted(settings):
        yield _budget_error_event()
        return
    yield AssistantStreamEvent(event="status", data={"label": _STATUS_WRITING})
    # End the read txn before the long narration await — narration needs no DB.
    session.rollback()
    async with contextlib.aclosing(
        _stream_final(
            llm_client,
            build_narration_messages(messages, "Draft answer (verified): " + message),
            message,
            settings.assistant_role,
            guard,
        )
    ) as final_events:
        async for event in final_events:
            yield event


def _recent_user_texts(
    messages: list[AssistantChatMessage], limit: int = 8
) -> list[str]:
    # Scan the recent user turns the model can actually see (prompts.py sends
    # messages[-8:]), not just the newest one, so a safety-score request split across
    # turns or carried by a short "yes, do that" follow-up still trips the guard.
    return [message.content for message in messages[-limit:] if message.role == "user"]


def _guard_user_texts(messages: list[AssistantChatMessage]) -> list[str]:
    """Scope deterministic guards to the current request.

    Once the immediately preceding assistant turn is a fixed refusal, ambiguous follow-ups
    inherit the refused request. This is deliberately fail-closed: instead of trying to list
    every possible "do it anyway" phrase, only a clearly new supported data/action request
    resets the scope. Older refusals do not poison later turns.
    """
    user_indexes = [index for index, message in enumerate(messages[-8:]) if message.role == "user"]
    if not user_indexes:
        return []
    recent = messages[-8:]
    latest_index = user_indexes[-1]
    latest = recent[latest_index].content
    # A new explicit guard request supersedes the previous refusal's category. Without
    # this, a presence question immediately after a safety refusal inherits both texts and
    # receives the safety redirect simply because that check runs first.
    if contains_safety_ranking(latest) or claims_user_presence(latest):
        return [latest]
    if latest_index >= 2:
        previous_assistant = recent[latest_index - 1]
        previous_user = recent[latest_index - 2]
        if (
            previous_assistant.role == "assistant"
            and previous_user.role == "user"
            and (
                contains_safety_ranking(previous_user.content)
                or claims_user_presence(previous_user.content)
            )
            and _CLEAR_NEW_REQUEST_PATTERN.search(latest) is None
        ):
            return [previous_user.content, latest]
    return [latest]


async def _complete_plan(
    llm_client: AssistantLlmClient,
    planning_messages: list[dict[str, str]],
    role: str,
) -> str:
    """Use schema-constrained planning when the selected adapter supports it."""
    structured_complete = getattr(llm_client, "complete_structured", None)
    if callable(structured_complete):
        return await structured_complete(
            planning_messages,
            response_format=PLANNING_RESPONSE_FORMAT,
            role=role,
            temperature=0.2,
            max_tokens=1024,
        )
    return await llm_client.complete(
        planning_messages,
        role=role,
        temperature=0.2,
        max_tokens=1024,
    )


async def _stream_final(
    llm_client: AssistantLlmClient,
    narration_messages: list[dict[str, str]],
    fallback_text: str,
    role: str,
    guard: Callable[[str], str | None] = output_guard_redirect,
) -> AsyncIterator[AssistantStreamEvent]:
    """Stream the narrated final through the holdback guard. On a guard trip,
    replace with the redirect; on any narration failure (unreachable, empty,
    mid-stream death), replace with fallback_text. Always ends with done."""
    yielded_any = False
    try:
        async with contextlib.aclosing(
            guarded_stream(
                llm_client.stream(
                    narration_messages,
                    role=role,
                    temperature=_NARRATION_TEMPERATURE,
                    max_tokens=_NARRATION_MAX_TOKENS,
                ),
                guard,
            )
        ) as chunks:
            async for chunk in chunks:
                yielded_any = True
                yield AssistantStreamEvent(event="token", data={"delta": chunk})
    except StreamGuardTripped as trip:
        yield AssistantStreamEvent(event="replace", data={"text": trip.redirect})
        yield AssistantStreamEvent(event="done", data={})
        return
    except (LlmUnavailable, LlmStreamInterrupted):
        yield AssistantStreamEvent(event="replace", data={"text": fallback_text})
        yield AssistantStreamEvent(event="done", data={})
        return
    if not yielded_any:
        # A protocol-abiding client that ends cleanly with zero deltas (the real
        # client raises LlmUnavailable instead) must still produce an answer.
        yield AssistantStreamEvent(event="replace", data={"text": fallback_text})
    yield AssistantStreamEvent(event="done", data={})


def _tool_arguments(
    tool_name: str,
    dashboard_state: AssistantDashboardState,
    model_arguments: Any,
    user_text: str = "",
    *,
    latest_result_context: AssistantResultContext | None = None,
    use_latest_result: bool = False,
) -> dict[str, Any]:
    """Backfill selection-tool arguments from the dashboard state.

    Small local models routinely emit a ``tool_call`` with empty ``arguments``.
    The agent already holds the authoritative selection (places, radius, dates),
    so we inject it and let any model-provided values override — except for an
    explicit relative window ("last 12 months"), which is arithmetic the agent
    does itself (see _relative_window).
    """
    if tool_name == "explain_result":
        if latest_result_context is None:
            raise AssistantClarification(
                "Run an analysis first, then ask me about the result."
            )
        return _latest_result_arguments(latest_result_context)
    if use_latest_result:
        if latest_result_context is None:
            raise AssistantClarification(
                "I don't have a previous result to rerun yet."
            )
        dashboard_state = _latest_result_dashboard_state(latest_result_context)

    raw_arguments = model_arguments if isinstance(model_arguments, dict) else {}
    arguments = {
        key: value
        for key, value in raw_arguments.items()
        # Coordinates are application-owned context, never model-authored arguments.
        if key != "points" and value not in (None, "", [])
    }
    arguments = _with_explicit_radius(tool_name, arguments, user_text)
    if tool_name not in SELECTION_TOOLS:
        return _with_relative_window(tool_name, dashboard_state, arguments, user_text)

    defaults: dict[str, Any] = {
        "analysis_start_date": (
            dashboard_state.analysis_start_date.isoformat()
            if dashboard_state.analysis_start_date
            else None
        ),
        "analysis_end_date": (
            dashboard_state.analysis_end_date.isoformat()
            if dashboard_state.analysis_end_date
            else None
        ),
        "offense_category": dashboard_state.offense_category,
        "offense_subcategory": dashboard_state.offense_subcategory,
        "nibrs_group": dashboard_state.nibrs_group,
        "layer": dashboard_state.layer,
    }
    if dashboard_state.selected_points:
        defaults["points"] = [
            point.model_dump(mode="json") for point in dashboard_state.selected_points
        ]
        # A local model may echo stale ids from the prompt. Inline points are the complete,
        # authoritative mixed/ad-hoc selection, so never send both selection forms.
        arguments.pop("place_ids", None)
    else:
        defaults["place_ids"] = list(dashboard_state.selected_place_ids)
    if tool_name == "compare_places":
        defaults["radius_m"] = dashboard_state.radii_m[0] if dashboard_state.radii_m else None
    else:
        # AssistantDashboardState allows duplicate radii; the request schema requires them
        # unique, so dedupe (order-preserving) before backfilling.
        defaults["radii_m"] = list(dict.fromkeys(dashboard_state.radii_m))

    merged = {key: value for key, value in defaults.items() if value not in (None, "", [])}
    merged.update(arguments)
    return _with_relative_window(tool_name, dashboard_state, merged, user_text)


def _latest_result_arguments(context: AssistantResultContext) -> dict[str, Any]:
    arguments = {
        "kind": context.kind,
        "analysis_start_date": context.analysis_start_date.isoformat(),
        "analysis_end_date": context.analysis_end_date.isoformat(),
        "radius_m": context.radius_m,
        "offense_category": context.offense_category,
        "offense_subcategory": context.offense_subcategory,
        "nibrs_group": context.nibrs_group,
        "layer": context.layer,
    }
    if context.points:
        arguments["points"] = [point.model_dump(mode="json") for point in context.points]
    else:
        arguments["place_ids"] = list(context.place_ids)
    return arguments


def _latest_result_dashboard_state(
    context: AssistantResultContext,
) -> AssistantDashboardState:
    return AssistantDashboardState(
        selected_place_ids=list(context.place_ids),
        selected_points=list(context.points),
        analysis_start_date=context.analysis_start_date,
        analysis_end_date=context.analysis_end_date,
        radii_m=[context.radius_m],
        offense_category=context.offense_category,
        offense_subcategory=context.offense_subcategory,
        nibrs_group=context.nibrs_group,
        layer=context.layer,
    )


# Tools that take an analysis window. update_filters is not a selection tool but still
# carries the dates, so the backstop has to cover it too.
_DATE_WINDOW_TOOLS = frozenset(SELECTION_TOOLS) | {"update_filters"}
_RADIUS_TOOLS = frozenset(SELECTION_TOOLS) | {"update_filters"}
_RELATIVE_WINDOW_PATTERN = re.compile(
    r"\b(?:last|past)\s+(?:(\d{1,3})\s+)?(day|week|month|year)s?\b", re.IGNORECASE
)
_RADIUS_AFTER_LABEL_PATTERN = re.compile(
    r"\bradius\s*(?:(?:to|of)\s*|=\s*)?(\d{2,5})"
    r"(?:\s*(?:m|meters?|metres?))?"
    r"(?!\s*(?:km|kilometers?|kilometres?|ft|feet|foot|mi|miles?)\b)\b",
    re.IGNORECASE,
)
_RADIUS_WITH_UNIT_PATTERN = re.compile(
    r"\b(\d{2,5})\s*(?:m|meters?|metres?)\b",
    re.IGNORECASE,
)


def _with_explicit_radius(
    tool_name: str,
    arguments: dict[str, Any],
    user_text: str,
) -> dict[str, Any]:
    """Backfill an explicit meter value when the planner omitted the radius field."""
    if tool_name not in _RADIUS_TOOLS:
        return arguments
    target = "radius_m" if tool_name in {"compare_places", "update_filters"} else "radii_m"
    if target in arguments:
        return arguments
    match = _RADIUS_AFTER_LABEL_PATTERN.search(user_text or "")
    if match is None:
        match = _RADIUS_WITH_UNIT_PATTERN.search(user_text or "")
    if match is None:
        return arguments
    radius = int(match.group(1))
    value: int | list[int] = radius if target == "radius_m" else [radius]
    return {**arguments, target: value}


def _with_relative_window(
    tool_name: str,
    dashboard_state: AssistantDashboardState,
    arguments: dict[str, Any],
    user_text: str,
) -> dict[str, Any]:
    """Recompute an explicit relative window deterministically and override the model.

    Models get "last 12 months" wrong in the way that matters least visibly and most
    often — right length, wrong year. The phrase is unambiguous arithmetic against the
    active window's end date, so it does not need judgement.
    """
    if tool_name not in _DATE_WINDOW_TOOLS:
        return arguments
    end = dashboard_state.analysis_end_date or _parse_date(arguments.get("analysis_end_date"))
    window = _relative_window(user_text, end)
    if window is None:
        return arguments
    start, end = window
    return {
        **arguments,
        "analysis_start_date": start.isoformat(),
        "analysis_end_date": end.isoformat(),
    }


def _relative_window(user_text: str, end: date | None) -> tuple[date, date] | None:
    match = _RELATIVE_WINDOW_PATTERN.search(user_text or "")
    if match is None or end is None:
        return None
    # Bare "last month"/"past year" means one unit; clamp large N so "last 999 years"
    # can't produce a pre-dataset window (the data floor is 2018; 2008 is a safe floor).
    amount = int(match.group(1)) if match.group(1) else 1
    unit = match.group(2).lower()
    if amount < 1:
        return None
    amount = min(amount, 100)
    if unit == "day":
        start = end - timedelta(days=amount - 1)
    elif unit == "week":
        start = end - timedelta(days=amount * 7 - 1)
    else:
        months = amount * 12 if unit == "year" else amount
        start = _months_before(end, months) + timedelta(days=1)
    return max(start, date(2008, 1, 1)), end


def _months_before(value: date, months: int) -> date:
    """``value`` shifted back ``months`` calendar months, clamped to the shorter month."""
    total = value.year * 12 + value.month - 1 - months
    year, month = divmod(total, 12)
    day = min(value.day, monthrange(year, month + 1)[1])
    return date(year, month + 1, day)


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def _parse_model_json(raw: str) -> dict[str, Any]:
    for candidate in _json_candidates(raw.strip()):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    raise ValueError("The local model returned an invalid assistant plan.")


def _json_candidates(text: str) -> list[str]:
    candidates = [text]
    fenced = _strip_code_fence(text)
    if fenced != text:
        candidates.append(fenced)
    extracted = _extract_first_json_object(fenced)
    if extracted is not None and extracted not in candidates:
        candidates.append(extracted)
    return candidates


def _strip_code_fence(text: str) -> str:
    stripped = text.strip()
    if not stripped.startswith("```"):
        return text
    lines = stripped.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip().startswith("```"):
        lines = lines[:-1]
    return "\n".join(lines)


def _extract_first_json_object(text: str) -> str | None:
    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def _final_message(plan: dict[str, Any]) -> str:
    if plan.get("type") != "final":
        raise ValueError("The local model did not return a final assistant answer.")
    message = plan.get("message")
    if not isinstance(message, str) or not message.strip():
        raise ValueError("The local model returned an empty assistant answer.")
    return message.strip()

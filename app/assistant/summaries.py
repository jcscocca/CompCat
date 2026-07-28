from __future__ import annotations

from typing import Any

from app.assistant.output_guard import guarded

_DECISION_PHRASES = {
    "above_clear": "above its surrounding-area baseline, statistically clear",
    "below_clear": "below its surrounding-area baseline, statistically clear",
    "not_clear": "not statistically clear vs its surrounding area",
    "insufficient_data": "not enough data for a surrounding-area comparison",
    "model_warning": "too few months to model reliably",
    "baseline_unavailable": "no neighborhood baseline available",
}

# Layer-aware framing: arrests are enforcement activity and 911 calls are requests
# for service — neither may be presented as reported incidents.
_LAYER_TERMS = {
    "reported": ("From the reports: ", "reported incidents"),
    "arrests": ("From the arrest records: ", "arrests"),
    "calls": ("From the call logs: ", "911 calls"),
}


def _layer_terms(result: dict[str, Any]) -> tuple[str, str]:
    layer = (result.get("settings_used") or {}).get("layer") or "reported"
    return _LAYER_TERMS.get(layer, _LAYER_TERMS["reported"])


def build_tool_summary(tool_result: dict[str, Any]) -> str:
    """A neutral, invariant-safe one-liner for a tool result, built from fields
    the result already carries (no safety scoring/ranking, no LLM).

    The text is user-bound on every path that calls this — the chat turn's kill-switch
    and fallback emissions, and the /assistant/commands route, which streams it with no
    model in the loop — and it interpolates user-controlled place labels. So the finished
    line runs through the output guard here, once, rather than at each emission site."""
    result = tool_result.get("result") or {}
    handler = {
        "add_place": _add_place_summary,
        "select_places": _select_places_summary,
        "analyze_places": _analyze_places_summary,
        "compare_places": _compare_places_summary,
        "get_dashboard_summary": _dashboard_summary,
        "suggest_followups": _suggest_followups_summary,
        "update_filters": _update_filters_summary,
    }.get(tool_result.get("tool_name"))
    if handler is None:
        return "Done."
    return guarded(handler(result) or "Done.")


def _add_place_summary(result: dict[str, Any]) -> str:
    label = (result.get("place") or {}).get("display_label") or "the place"
    if result.get("created"):
        address = result.get("address")
        return f"Saved {label} at {address}." if address else f"Saved {label}."
    return f"Found {label} in your saved places."


def _select_places_summary(result: dict[str, Any]) -> str:
    if result.get("mode") == "clear":
        return "Cleared the selection."
    labels = _resolved_labels(result)
    parts: list[str] = []
    if labels:
        verb = "Added" if result.get("mode") == "add" else "Selected"
        parts.append(f"{verb} {_join(labels)}.")
    elif not result.get("unresolved"):
        parts.append("No matching places.")
    parts.extend(_unresolved_sentences(result))
    return " ".join(parts) if parts else "No matching places."


_RELATION_PHRASES = {
    "above": "above",
    "below": "below",
    "similar": "about the same as",
}


def _primary_baseline(place: dict[str, Any]) -> dict[str, Any] | None:
    by_kind = {entry.get("kind"): entry for entry in place.get("baselines") or []}
    return by_kind.get("mcpp") or by_kind.get("beat") or by_kind.get("city")


# Decisions that mean "no comparison was actually made". A baseline entry can still carry a
# ratio in these cases (each entry is tested independently, and a wide-area citywide entry
# will happily return 88.9× off two incidents), but the place-level verdict is authoritative:
# stating the ratio anyway is the difference between context and a fabricated finding.
_UNTESTED_DECISIONS = frozenset({"insufficient_data", "model_warning", "baseline_unavailable"})


def _rate_ratio_is_reportable(place: dict[str, Any]) -> bool:
    if place.get("baseline_available") is False:
        return False
    if place.get("decision") in _UNTESTED_DECISIONS:
        return False
    status = place.get("minimum_data_status")
    return status is None or status == "met"


def _analyze_places_summary(result: dict[str, Any]) -> str:
    radius = (result.get("settings_used") or {}).get("radius_m")
    lead_in, noun = _layer_terms(result)
    places = (result.get("neighborhood") or {}).get("places") or []
    sentences: list[str] = []
    for place in places:
        label = place.get("place_label") or "The place"
        count = place.get("place_incident_count") or 0
        entry = _primary_baseline(place) if _rate_ratio_is_reportable(place) else None
        relation = (entry or {}).get("relation")
        if entry and relation in _RELATION_PHRASES and entry.get("rate_ratio") is not None:
            ci = ""
            lower, upper = entry.get("ci_lower"), entry.get("ci_upper")
            if lower is not None and upper is not None:
                ci = f" (95% CI {lower:.1f}–{upper:.1f})"
            sentences.append(
                f"{label}: {entry['rate_ratio']:.1f}× — {_RELATION_PHRASES[relation]} "
                f"{entry.get('label')}'s rate{ci}; {count} {noun} within {radius} m."
            )
        else:
            phrase = _DECISION_PHRASES.get(place.get("decision"), "no area comparison")
            sentences.append(f"{label}: {count} {noun} within {radius} m ({phrase}).")
    summary = (lead_in + " ".join(sentences)) if sentences else "No places to analyze."
    return _with_provenance(summary, result)


def _compare_places_summary(result: dict[str, Any]) -> str:
    radius = (result.get("settings_used") or {}).get("radius_m")
    lead_in, noun = _layer_terms(result)
    overview = (result.get("comparison") or {}).get("overview") or {}
    options = overview.get("options") or []
    parts: list[str] = []
    counts = "; ".join(
        f"{o.get('label')}: {o.get('incident_count')}"
        for o in options
        if o.get("label") and o.get("incident_count") is not None
    )
    if counts:
        parts.append(f"{noun.capitalize()} within {radius} m — {counts}.")
    if overview.get("summary_text"):
        parts.append(overview["summary_text"])
    parts.extend(_untested_pair_sentences(result))
    summary = (lead_in + " ".join(parts)) if parts else "Compared the selected places."
    return _with_provenance(summary, result)


# app/analysis/comparison.py fills an untested pair's rate_ratio/CI/p with 1.0 placeholders so
# the row is storable. Those are not findings — surfacing them as "1.0× (95% CI 1.0–1.0, p 1.0)"
# reads as a confident "no difference" verdict that was never computed.
_NOT_TESTED_METHOD = "not_tested_minimum_data"
_MAX_UNTESTED_PAIRS_LISTED = 3


def _untested_pair_sentences(result: dict[str, Any]) -> list[str]:
    pairwise = ((result.get("comparison") or {}).get("analytical") or {}).get(
        "pairwise_results"
    ) or []
    pairs = [
        f"{entry.get('option_a_label')} vs {entry.get('option_b_label')}"
        for entry in pairwise
        if entry.get("method") == _NOT_TESTED_METHOD
        or (entry.get("minimum_data_status") or "met") != "met"
    ]
    if not pairs:
        return []
    listed = pairs[:_MAX_UNTESTED_PAIRS_LISTED]
    remainder = len(pairs) - len(listed)
    tail = f", and {remainder} more" if remainder else ""
    return [f"Not tested (below the data floor): {_join(listed)}{tail}."]


def _dashboard_summary(result: dict[str, Any]) -> str:
    count = (result.get("totals") or {}).get("place_count") or 0
    return f"You have {count} saved place{'' if count == 1 else 's'}."


def _update_filters_summary(result: dict[str, Any]) -> str:
    patch = result.get("patch") or {}
    parts: list[str] = []
    if "radius_m" in patch:
        parts.append(f"radius {patch['radius_m']} m")
    if "analysis_start_date" in patch or "analysis_end_date" in patch:
        parts.append(
            f"dates {patch.get('analysis_start_date', '…')} – {patch.get('analysis_end_date', '…')}"
        )
    if "offense_category" in patch:
        parts.append(f"categories {patch['offense_category'] or 'all reported'}")
    if "layer" in patch:
        parts.append(f"layer {patch['layer']}")
    return "Updated the filters: " + " · ".join(parts) + "."


def _suggest_followups_summary(result: dict[str, Any]) -> str:
    suggestions = result.get("suggestions") or []
    if not suggestions:
        return "Here are some things you can try next."
    # Newline-separated dashes: the chat pane renders markdown, so these arrive as a list
    # instead of one run-on sentence with bullet glyphs in it.
    return "You could:\n" + "\n".join(f"- {item}" for item in suggestions)


def _resolved_labels(result: dict[str, Any]) -> list[str]:
    labels: list[str] = []
    for entry in (result.get("matched") or []) + (result.get("created") or []):
        if entry.get("label"):
            labels.append(entry["label"])
    return labels


def _created_sentences(result: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for entry in result.get("created") or []:
        label = entry.get("label") or entry.get("query") or "a place"
        address = entry.get("address")
        out.append(f"Saved {label} at {address}." if address else f"Saved {label}.")
    return out


def _unresolved_sentences(result: dict[str, Any]) -> list[str]:
    return [f"Couldn’t find “{query}”." for query in (result.get("unresolved") or [])]


def _with_provenance(summary: str, result: dict[str, Any]) -> str:
    return " ".join([summary, *_created_sentences(result), *_unresolved_sentences(result)]).strip()


def _join(items: list[str]) -> str:
    items = [item for item in items if item]
    if len(items) <= 1:
        return items[0] if items else ""
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"

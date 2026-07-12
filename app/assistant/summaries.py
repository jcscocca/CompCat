from __future__ import annotations

from typing import Any

_DECISION_PHRASES = {
    "above_clear": "above its surrounding-area baseline, statistically clear",
    "below_clear": "below its surrounding-area baseline, statistically clear",
    "not_clear": "not statistically clear vs its surrounding area",
    "insufficient_data": "insufficient data for a surrounding-area comparison",
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
    the result already carries (no safety scoring/ranking, no LLM)."""
    result = tool_result.get("result") or {}
    handler = {
        "add_place": _add_place_summary,
        "select_places": _select_places_summary,
        "analyze_places": _analyze_places_summary,
        "compare_places": _compare_places_summary,
        "get_dashboard_summary": _dashboard_summary,
        "suggest_followups": _suggest_followups_summary,
    }.get(tool_result.get("tool_name"))
    if handler is None:
        return "Done."
    return handler(result) or "Done."


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


def _analyze_places_summary(result: dict[str, Any]) -> str:
    radius = (result.get("settings_used") or {}).get("radius_m")
    lead_in, noun = _layer_terms(result)
    places = (result.get("neighborhood") or {}).get("places") or []
    sentences: list[str] = []
    for place in places:
        label = place.get("place_label") or "The place"
        count = place.get("place_incident_count") or 0
        if place.get("baseline_available") and place.get("rate_ratio") is not None:
            phrase = _DECISION_PHRASES.get(
                place.get("decision"), "compared to its surrounding area"
            )
            ci = ""
            lower, upper = place.get("ci_lower"), place.get("ci_upper")
            if lower is not None and upper is not None:
                ci = f" (95% CI {lower:.1f}–{upper:.1f})"
            sentences.append(
                f"{label}: {place['rate_ratio']:.1f}× its surrounding area — {phrase}{ci}; "
                f"{count} {noun} within {radius} m."
            )
        else:
            phrase = _DECISION_PHRASES.get(place.get("decision"), "no surrounding-area comparison")
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
    summary = (lead_in + " ".join(parts)) if parts else "Compared the selected places."
    return _with_provenance(summary, result)


def _dashboard_summary(result: dict[str, Any]) -> str:
    count = (result.get("totals") or {}).get("place_count") or 0
    return f"You have {count} saved place{'' if count == 1 else 's'}."


def _suggest_followups_summary(result: dict[str, Any]) -> str:
    suggestions = result.get("suggestions") or []
    if not suggestions:
        return "Here are some things you can try next."
    return "You could: " + " ".join(f"• {item}" for item in suggestions)


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

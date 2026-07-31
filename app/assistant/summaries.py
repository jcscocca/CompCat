from __future__ import annotations

import re
from typing import Any

from app.assistant.output_guard import SAFETY_REDIRECT, output_guard_redirect

DECISION_PHRASES = {
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


def layer_noun(layer: str | None) -> str:
    return _LAYER_TERMS.get(layer or "reported", _LAYER_TERMS["reported"])[1]


def _layer_terms(result: dict[str, Any]) -> tuple[str, str]:
    layer = (result.get("settings_used") or {}).get("layer") or "reported"
    return _LAYER_TERMS.get(layer, _LAYER_TERMS["reported"])


def build_tool_summary(tool_result: dict[str, Any]) -> str:
    """A neutral, invariant-safe one-liner for a tool result, built from fields
    the result already carries (no safety scoring/ranking, no LLM).

    The text is user-bound on every path that calls this — the chat turn's kill-switch
    and fallback emissions, and the /assistant/commands route, which streams it with no
    model in the loop. User-controlled labels are masked while the generated prose is
    checked, then restored; otherwise a legitimate proper name such as "Public Safety
    Building" trips a guard intended for assistant-authored safety claims."""
    result = tool_result.get("result") or {}
    handler = {
        "add_place": _add_place_summary,
        "select_places": _select_places_summary,
        "analyze_places": _analyze_places_summary,
        "compare_places": _compare_places_summary,
        "explain_result": _explain_result_summary,
        "get_dashboard_summary": _dashboard_summary,
        "suggest_followups": _suggest_followups_summary,
        "update_filters": _update_filters_summary,
    }.get(tool_result.get("tool_name"))
    if handler is None:
        return "Done."
    return _guard_summary_with_labels(handler(result) or "Done.", result)


_HOSTILE_LABEL_PROSE = re.compile(
    r"\b(?:do\s+not|don't|never|ignore|disregard|avoid|stay\s+away|go\s+there"
    r"|recommend(?:ed|ing)?|very\s+(?:dangerous|unsafe|risky)"
    r"|safe(?:r|st)?|unsafe|dangerous|risky"
    r"|(?:is|are)\s+(?:safe|unsafe|dangerous|risky))\b"
    r"|\b(?:best|worst|number\s+one)\b[^.?!]{0,24}\bsafety\b"
    r"|\bsafety\b[^.?!]{0,24}\b(?:score|rank|rating|best|worst)\b",
    re.IGNORECASE,
)


def _guard_summary_with_labels(summary: str, result: dict[str, Any]) -> str:
    """Guard assistant-authored prose without treating proper-name words as claims.

    Labels remain untrusted: sentence-like instructions or assertions inside one still
    receive the normal output redirect. Benign proper names are replaced by inert tokens
    during the prose scan, then restored byte-for-byte.
    """
    labels = sorted(_interpolated_labels(result), key=len, reverse=True)
    for label in labels:
        redirect = output_guard_redirect(label)
        if _HOSTILE_LABEL_PROSE.search(label):
            return redirect or SAFETY_REDIRECT

    masked = summary
    replacements: list[tuple[str, str]] = []
    for index, label in enumerate(labels):
        token = f"COMPCATLABELTOKEN{index}"
        if label in masked:
            masked = masked.replace(label, token)
            replacements.append((token, label))

    redirect = output_guard_redirect(masked)
    if redirect is not None:
        return redirect
    for token, label in replacements:
        masked = masked.replace(token, label)
    return masked


def _interpolated_labels(result: dict[str, Any]) -> set[str]:
    """Return only free-text fields summary builders interpolate as labels/addresses.

    Deliberately do not recurse through every string: service-authored ``summary_text``
    must remain visible to the output guard even when it contains a violating claim.
    """
    labels: set[str] = set()

    def add(value: Any) -> None:
        if isinstance(value, str) and value:
            labels.add(value)

    place = result.get("place") or {}
    add(place.get("display_label"))
    add(result.get("address"))
    for key in ("matched", "created"):
        entries = result.get(key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            for field in ("query", "label", "address"):
                add(entry.get(field))
    for query in result.get("unresolved") or []:
        add(query)
    for place_entry in (result.get("neighborhood") or {}).get("places") or []:
        add(place_entry.get("place_label"))
        for reference in place_entry.get("reference_comparisons") or []:
            add(reference.get("label"))
            for component in reference.get("geography_components") or []:
                add(component.get("label"))
        for baseline in place_entry.get("baselines") or []:
            add(baseline.get("label"))
    comparison = result.get("comparison") or {}
    for option in (comparison.get("overview") or {}).get("options") or []:
        add(option.get("label"))
    for entry in (comparison.get("analytical") or {}).get("pairwise_results") or []:
        add(entry.get("option_a_label"))
        add(entry.get("option_b_label"))
    return labels


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
}


def _primary_baseline(place: dict[str, Any]) -> dict[str, Any] | None:
    by_kind = {entry.get("kind"): entry for entry in place.get("baselines") or []}
    return by_kind.get("mcpp") or by_kind.get("beat") or by_kind.get("city")


def _primary_reference(place: dict[str, Any]) -> dict[str, Any] | None:
    by_kind = {
        entry.get("kind"): entry
        for entry in place.get("reference_comparisons") or []
        if entry.get("available")
    }
    return by_kind.get("mcpp") or by_kind.get("sector") or by_kind.get("city")


def _reference_summary(
    *,
    label: str,
    count: int,
    noun: str,
    radius: Any,
    entry: dict[str, Any],
) -> str:
    fewer = round(float(entry.get("share_below") or 0) * 100)
    equal = round(float(entry.get("share_equal") or 0) * 100)
    more = round(float(entry.get("share_above") or 0) * 100)
    reference_label = entry.get("label") or "the reference area"
    return (
        f"{label}: {count} {noun} within {radius} m. Among eligible street locations "
        f"in {reference_label}, {fewer}% had fewer, {equal}% matched, and {more}% had "
        "more in equal-radius circles."
    )


# Decisions that mean "no comparison was actually made". A baseline entry can still carry a
# ratio in these cases (each entry is tested independently, and a wide-area citywide entry
# will happily return 88.9× off two incidents), but the place-level verdict is authoritative:
# stating the ratio anyway is the difference between context and a fabricated finding.
_UNTESTED_DECISIONS = frozenset({"insufficient_data", "model_warning", "baseline_unavailable"})


def rate_ratio_is_reportable(place: dict[str, Any]) -> bool:
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
        reference_comparisons = place.get("reference_comparisons")
        if isinstance(reference_comparisons, list):
            reference = _primary_reference(place)
            if reference is not None:
                sentences.append(
                    _reference_summary(
                        label=label,
                        count=count,
                        noun=noun,
                        radius=radius,
                        entry=reference,
                    )
                )
            else:
                sentences.append(
                    f"{label}: {count} {noun} within {radius} m "
                    "(no adequate reference-circle comparison)."
                )
            continue
        entry = _primary_baseline(place) if rate_ratio_is_reportable(place) else None
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
        elif entry and relation == "similar" and entry.get("rate_ratio") is not None:
            interval = ""
            lower, upper = entry.get("ci_lower"), entry.get("ci_upper")
            if lower is not None and upper is not None:
                interval = f", 95% CI {lower:.1f}–{upper:.1f}"
            sentences.append(
                f"{label}: no statistically clear difference from {entry.get('label')}'s "
                f"rate ({entry['rate_ratio']:.1f}×{interval}); {count} {noun} within "
                f"{radius} m."
            )
        else:
            phrase = DECISION_PHRASES.get(place.get("decision"), "no area comparison")
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


def _explain_result_summary(result: dict[str, Any]) -> str:
    if result.get("kind") == "compare":
        return _compare_places_summary(result)
    return _analyze_places_summary(result)


# app/analysis/comparison.py fills an untested pair's rate_ratio/CI/p with 1.0 placeholders so
# the row is storable. Those are not findings — surfacing them as "1.0× (95% CI 1.0–1.0, p 1.0)"
# reads as a confident "no difference" verdict that was never computed.
_NOT_TESTED_METHOD = "not_tested_minimum_data"
_MAX_UNTESTED_PAIRS_LISTED = 3


def pair_is_untested(entry: dict[str, Any]) -> bool:
    return entry.get("method") == _NOT_TESTED_METHOD or (
        entry.get("minimum_data_status") or "met"
    ) != "met"


def _untested_pair_sentences(result: dict[str, Any]) -> list[str]:
    pairwise = ((result.get("comparison") or {}).get("analytical") or {}).get(
        "pairwise_results"
    ) or []
    pairs = [
        f"{entry.get('option_a_label')} vs {entry.get('option_b_label')}"
        for entry in pairwise
        if pair_is_untested(entry)
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

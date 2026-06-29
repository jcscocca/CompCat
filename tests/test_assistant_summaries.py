from __future__ import annotations

from app.assistant.summaries import build_tool_summary


def _envelope(tool_name, result):
    return {"tool_name": tool_name, "arguments": {}, "result": result}


def test_compare_summary_uses_counts_and_overview():
    result = {
        "settings_used": {"radius_m": 250},
        "comparison": {
            "overview": {
                "summary_text": "Pike Place had more reported incidents than Capitol Hill.",
                "options": [
                    {"label": "Pike Place", "incident_count": 299},
                    {"label": "Capitol Hill", "incident_count": 20},
                ],
            }
        },
        "created": [],
        "unresolved": [],
    }
    text = build_tool_summary(_envelope("compare_places", result))
    assert "Pike Place: 299" in text
    assert "Capitol Hill: 20" in text
    assert "250 m" in text
    assert "more reported incidents" in text


def test_analyze_summary_reads_beat_verdict():
    result = {
        "settings_used": {"radius_m": 250},
        "neighborhood": {
            "places": [
                {
                    "place_label": "Capitol Hill",
                    "baseline_available": True,
                    "rate_ratio": 1.4,
                    "ci_lower": 1.1,
                    "ci_upper": 1.8,
                    "decision": "above_clear",
                    "place_incident_count": 84,
                }
            ]
        },
        "created": [],
        "unresolved": [],
    }
    text = build_tool_summary(_envelope("analyze_places", result))
    assert "Capitol Hill" in text
    assert "1.4×" in text
    assert "above its beat baseline, statistically clear" in text
    assert "95% CI 1.1–1.8" in text
    assert "84 reported incidents within 250 m" in text


def test_add_place_summary_reports_created_with_address():
    result = {
        "place": {"display_label": "Capitol Hill"},
        "place_id": "p1",
        "created": True,
        "address": "Capitol Hill, Seattle",
    }
    expected = "Saved Capitol Hill at Capitol Hill, Seattle."
    assert build_tool_summary(_envelope("add_place", result)) == expected


def test_add_place_summary_reports_existing_match():
    result = {
        "place": {"display_label": "Home"},
        "place_id": "p1",
        "created": False,
        "address": None,
    }
    assert build_tool_summary(_envelope("add_place", result)) == "Found Home in your saved places."


def test_summary_appends_provenance_for_created_and_unresolved():
    created_entry = {
        "query": "Capitol Hill",
        "label": "Capitol Hill",
        "address": "10th & Pine, Seattle",
    }
    result = {
        "settings_used": {"radius_m": 250},
        "comparison": {"overview": {"summary_text": "", "options": []}},
        "created": [created_entry],
        "unresolved": ["Florble Cafe"],
    }
    text = build_tool_summary(_envelope("compare_places", result))
    assert "Saved Capitol Hill at 10th & Pine, Seattle." in text
    assert "Couldn’t find “Florble Cafe”." in text


def test_unknown_tool_returns_nonempty():
    assert build_tool_summary(_envelope("run_place_analysis", {"summary_count": 1})) == "Done."


def test_select_places_summary_modes():
    base = {"matched": [{"label": "Home"}], "created": [], "unresolved": []}

    def summary(result):
        return build_tool_summary(_envelope("select_places", result))

    assert summary({**base, "mode": "replace"}) == "Selected Home."
    assert summary({**base, "mode": "add"}) == "Added Home."
    assert summary({"mode": "clear"}) == "Cleared the selection."


def test_analyze_summary_without_baseline():
    places = [{
        "place_label": "Home",
        "baseline_available": False,
        "decision": "baseline_unavailable",
        "place_incident_count": 5,
    }]
    result = {
        "settings_used": {"radius_m": 250},
        "neighborhood": {"places": places},
        "created": [],
        "unresolved": [],
    }
    text = build_tool_summary(_envelope("analyze_places", result))
    assert "Home: 5 reported incidents within 250 m" in text
    assert "no beat baseline available" in text

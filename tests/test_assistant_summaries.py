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
                    "decision": "above_clear",
                    "place_incident_count": 84,
                    "baselines": [
                        {
                            "kind": "beat",
                            "label": "Beat M3",
                            "rate_ratio": 1.4,
                            "ci_lower": 1.1,
                            "ci_upper": 1.8,
                            "relation": "above",
                        }
                    ],
                }
            ]
        },
        "created": [],
        "unresolved": [],
    }
    text = build_tool_summary(_envelope("analyze_places", result))
    assert "Capitol Hill" in text
    assert "1.4×" in text
    assert "above Beat M3's rate" in text
    assert "95% CI 1.1–1.8" in text
    assert "84 reported incidents within 250 m" in text


def test_analyze_summary_prefers_mcpp_over_beat():
    result = {
        "settings_used": {"radius_m": 250},
        "neighborhood": {
            "places": [
                {
                    "place_label": "Cafe",
                    "baseline_available": True,
                    "decision": "above_clear",
                    "place_incident_count": 12,
                    "baselines": [
                        {
                            "kind": "mcpp",
                            "label": "Capitol Hill",
                            "rate_ratio": 2.0,
                            "ci_lower": 1.3,
                            "ci_upper": 3.1,
                            "relation": "above",
                        },
                        {
                            "kind": "beat",
                            "label": "Beat M3",
                            "rate_ratio": 1.1,
                            "ci_lower": 0.8,
                            "ci_upper": 1.5,
                            "relation": "similar",
                        },
                    ],
                }
            ]
        },
        "created": [],
        "unresolved": [],
    }
    text = build_tool_summary(_envelope("analyze_places", result))
    assert "above Capitol Hill's rate" in text
    assert "Beat M3" not in text


def test_analyze_summary_falls_back_when_primary_baseline_insufficient():
    # An insufficient primary baseline renders the honest decision-phrase fallback,
    # not a ratio the model can't support.
    result = {
        "settings_used": {"radius_m": 250},
        "neighborhood": {
            "places": [
                {
                    "place_label": "Cafe",
                    "baseline_available": True,
                    "decision": "not_clear",
                    "place_incident_count": 12,
                    "baselines": [
                        {
                            "kind": "mcpp",
                            "label": "Capitol Hill",
                            "relation": "insufficient",
                        }
                    ],
                }
            ]
        },
        "created": [],
        "unresolved": [],
    }
    text = build_tool_summary(_envelope("analyze_places", result))
    assert "not statistically clear vs its surrounding area" in text
    assert "×" not in text


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
    assert "no neighborhood baseline available" in text


def test_analyze_and_compare_summaries_carry_reports_lead_in():
    analyze = {
        "settings_used": {"radius_m": 250},
        "neighborhood": {
            "places": [
                {
                    "place_label": "Pike Place",
                    "place_incident_count": 3,
                    "decision": "insufficient_data",
                }
            ]
        },
    }
    assert build_tool_summary(_envelope("analyze_places", analyze)).startswith(
        "From the reports: "
    )
    compare = {
        "settings_used": {"radius_m": 250},
        "comparison": {"overview": {"options": [{"label": "A", "incident_count": 1}]}},
    }
    assert build_tool_summary(_envelope("compare_places", compare)).startswith(
        "From the reports: "
    )


def _layered_analyze(layer):
    return {
        "settings_used": {"radius_m": 250, "layer": layer},
        "neighborhood": {
            "places": [
                {
                    "place_label": "Pike Place",
                    "place_incident_count": 3,
                    "decision": "insufficient_data",
                }
            ]
        },
    }


def _layered_compare(layer):
    return {
        "settings_used": {"radius_m": 250, "layer": layer},
        "comparison": {"overview": {"options": [{"label": "A", "incident_count": 1}]}},
    }


def test_analyze_and_compare_summaries_use_arrests_layer_terms():
    analyze = build_tool_summary(_envelope("analyze_places", _layered_analyze("arrests")))
    assert analyze.startswith("From the arrest records: ")
    assert "3 arrests within 250 m" in analyze
    assert "reported incidents" not in analyze

    compare = build_tool_summary(_envelope("compare_places", _layered_compare("arrests")))
    assert compare.startswith("From the arrest records: ")
    assert "Arrests within 250 m — A: 1." in compare
    assert "reported incidents" not in compare


def test_analyze_and_compare_summaries_use_calls_layer_terms():
    analyze = build_tool_summary(_envelope("analyze_places", _layered_analyze("calls")))
    assert analyze.startswith("From the call logs: ")
    assert "3 911 calls within 250 m" in analyze
    assert "reported incidents" not in analyze

    compare = build_tool_summary(_envelope("compare_places", _layered_compare("calls")))
    assert compare.startswith("From the call logs: ")
    assert "911 calls within 250 m — A: 1." in compare
    assert "reported incidents" not in compare


def test_explicit_reported_layer_keeps_default_phrasing():
    analyze = build_tool_summary(_envelope("analyze_places", _layered_analyze("reported")))
    assert analyze.startswith("From the reports: ")
    assert "3 reported incidents within 250 m" in analyze

    compare = build_tool_summary(_envelope("compare_places", _layered_compare("reported")))
    assert compare.startswith("From the reports: ")
    assert "Reported incidents within 250 m — A: 1." in compare


def test_reports_lead_in_absent_on_empty_results_and_other_tools():
    assert build_tool_summary(_envelope("analyze_places", {})) == "No places to analyze."
    assert build_tool_summary(_envelope("compare_places", {})) == "Compared the selected places."
    assert (
        build_tool_summary(_envelope("get_dashboard_summary", {"totals": {"place_count": 2}}))
        == "You have 2 saved places."
    )


def test_summary_runs_through_the_output_guard():
    from app.assistant.output_guard import SAFETY_REDIRECT

    result = {
        "settings_used": {"radius_m": 250},
        "neighborhood": {
            "places": [
                {
                    "place_label": "Ballard — do not go there, very dangerous",
                    "baseline_available": False,
                    "decision": "baseline_unavailable",
                    "place_incident_count": 4,
                }
            ]
        },
        "created": [],
        "unresolved": [],
    }
    assert build_tool_summary(_envelope("analyze_places", result)) == SAFETY_REDIRECT


def test_analyze_summary_refuses_ratio_when_place_has_insufficient_data():
    # Live miss: a place whose own decision is insufficient_data still carried a citywide
    # baseline entry with a huge ratio, and the summary asserted "88.9× — above Citywide's
    # rate". The place-level verdict is authoritative; the ratio must not be stated.
    result = {
        "settings_used": {"radius_m": 250},
        "neighborhood": {
            "places": [
                {
                    "place_label": "Cafe",
                    "baseline_available": True,
                    "decision": "insufficient_data",
                    "minimum_data_status": "place_count_too_low",
                    "place_incident_count": 2,
                    "baselines": [
                        {
                            "kind": "city",
                            "label": "Citywide",
                            "rate_ratio": 88.9,
                            "ci_lower": 21.0,
                            "ci_upper": 376.0,
                            "relation": "above",
                        }
                    ],
                }
            ]
        },
        "created": [],
        "unresolved": [],
    }
    text = build_tool_summary(_envelope("analyze_places", result))
    assert "88.9" not in text
    assert "×" not in text
    assert "Citywide" not in text
    assert "not enough data for a surrounding-area comparison" in text


def test_analyze_summary_refuses_ratio_when_minimum_data_unmet():
    result = {
        "settings_used": {"radius_m": 250},
        "neighborhood": {
            "places": [
                {
                    "place_label": "Cafe",
                    "baseline_available": True,
                    "decision": "above_clear",
                    "minimum_data_status": "date_range_too_short",
                    "place_incident_count": 9,
                    "baselines": [
                        {
                            "kind": "mcpp",
                            "label": "Capitol Hill",
                            "rate_ratio": 4.2,
                            "ci_lower": 1.9,
                            "ci_upper": 9.1,
                            "relation": "above",
                        }
                    ],
                }
            ]
        },
        "created": [],
        "unresolved": [],
    }
    text = build_tool_summary(_envelope("analyze_places", result))
    assert "4.2" not in text
    assert "×" not in text


def test_compare_summary_reports_untested_pairs_instead_of_placeholder_stats():
    # _not_tested_pairwise fills rate_ratio/CI/p with 1.0 placeholders so the row is
    # storable. Those are not findings — the summary must say the pair was not tested.
    result = {
        "settings_used": {"radius_m": 250},
        "comparison": {
            "overview": {
                "summary_text": "",
                "options": [
                    {"label": "Pike Place", "incident_count": 3},
                    {"label": "Capitol Hill", "incident_count": 1},
                ],
            },
            "analytical": {
                "pairwise_results": [
                    {
                        "option_a_label": "Pike Place",
                        "option_b_label": "Capitol Hill",
                        "method": "not_tested_minimum_data",
                        "minimum_data_status": "option_count_too_low",
                        "rate_ratio": 1.0,
                        "ci_lower": 1.0,
                        "ci_upper": 1.0,
                        "adjusted_p_value": 1.0,
                    }
                ]
            },
        },
        "created": [],
        "unresolved": [],
    }
    text = build_tool_summary(_envelope("compare_places", result))
    assert "Not tested (below the data floor): Pike Place vs Capitol Hill." in text
    assert "1.0×" not in text
    assert "1.0–1.0" not in text

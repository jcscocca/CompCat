from __future__ import annotations

import argparse
import copy
import json

import pytest

from scripts import evaluate_assistant


def test_versioned_corpus_loads_and_has_acceptance_subset() -> None:
    corpus = evaluate_assistant.load_corpus(evaluate_assistant.DEFAULT_CORPUS)

    assert corpus["schema_version"] == 1
    assert len(corpus["cases"]) >= 12
    acceptance = evaluate_assistant.select_cases(corpus, [], ["acceptance"])
    assert 6 <= len(acceptance) < len(corpus["cases"])
    assert all("acceptance" in case["tags"] for case in acceptance)


def test_corpus_rejects_duplicate_case_ids(tmp_path) -> None:
    path = tmp_path / "bad.json"
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "cases": [
                    {"id": "same", "turns": [{"prompt": "one"}]},
                    {"id": "same", "turns": [{"prompt": "two"}]},
                ],
            }
        )
    )

    with pytest.raises(evaluate_assistant.EvalConfigurationError, match="duplicate"):
        evaluate_assistant.load_corpus(path)


def test_parse_sse_and_replace_build_the_rendered_response() -> None:
    events = evaluate_assistant.parse_sse(
        iter(
            [
                "event: token",
                'data: {"delta":"partial"}',
                "",
                "event: replace",
                'data: {"text":"authoritative fallback"}',
                "",
                "event: done",
                "data: {}",
                "",
            ]
        )
    )

    assert [event["event"] for event in events] == ["token", "replace", "done"]
    assert evaluate_assistant.response_text(events) == "authoritative fallback"


def test_turn_checks_properties_and_nested_tool_argument_subset() -> None:
    events = [
        {
            "event": "tool",
            "data": {
                "tool_name": "update_filters",
                "arguments": {"radius_m": 500, "offense_category": "PROPERTY", "layer": "reported"},
            },
        },
        {"event": "token", "data": {"delta": "Filters now use 500 m for property reports."}},
        {"event": "done", "data": {}},
    ]

    checks = evaluate_assistant.check_turn(
        events,
        2.5,
        {
            "tool_name": "update_filters",
            "tool_arguments": {"radius_m": 500, "offense_category": "PROPERTY"},
            "response_regex_any": ["property"],
            "response_not_regex": ["safe neighborhood"],
            "max_seconds": 3,
        },
    )

    assert all(check["passed"] for check in checks)


def test_turn_checks_fail_on_error_missing_done_and_wrong_tool() -> None:
    checks = evaluate_assistant.check_turn(
        [{"event": "error", "data": {"message": "offline"}}],
        1.0,
        {"tool_name": "analyze_places"},
    )

    failed = {check["name"] for check in checks if not check["passed"]}
    assert {"terminal_done", "no_error", "nonempty_response", "tool_name"} <= failed


def test_groq_target_requires_an_explicit_app_url(monkeypatch) -> None:
    monkeypatch.delenv("COMPCAT_EVAL_GROQ_URL", raising=False)
    args = argparse.Namespace(target="groq", base_url=None)

    with pytest.raises(evaluate_assistant.EvalConfigurationError, match="quota-consuming"):
        evaluate_assistant.resolve_base_url(args)


def test_baseline_is_validated_before_an_expensive_run(tmp_path, capsys) -> None:
    baseline = tmp_path / "not-a-report.json"
    baseline.write_text('{"schema_version": 1}')

    exit_code = evaluate_assistant.main(
        ["--target", "local", "--baseline", str(baseline), "--dry-run"]
    )

    assert exit_code == 2
    assert "baseline" in capsys.readouterr().err


def test_dry_run_validates_without_opening_a_session(capsys) -> None:
    exit_code = evaluate_assistant.main(
        ["--target", "local", "--case", "guard_safety_ranking", "--dry-run"]
    )

    assert exit_code == 0
    assert "cases=1 turns=1" in capsys.readouterr().out


def test_report_writer_uses_utf8_and_atomic_replace(tmp_path, monkeypatch) -> None:
    output = tmp_path / "report.json"
    calls: dict[str, object] = {}

    def capture_write(path, data, *, encoding=None, **_kwargs):
        calls["temporary"] = path
        calls["data"] = data
        calls["encoding"] = encoding
        return len(data)

    def capture_replace(path, target):
        calls["replace_source"] = path
        calls["replace_target"] = target
        return target

    monkeypatch.setattr(type(output), "write_text", capture_write)
    monkeypatch.setattr(type(output), "replace", capture_replace)

    evaluate_assistant.write_report(output, {"response": "1\u202f000 reports"})

    assert calls["encoding"] == "utf-8"
    assert calls["temporary"] == tmp_path / ".report.json.tmp"
    assert calls["replace_source"] == calls["temporary"]
    assert calls["replace_target"] == output
    assert "1\u202f000 reports" in str(calls["data"])


def test_main_checkpoints_every_completed_case(tmp_path, monkeypatch) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

    class FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def post(self, *_args, **_kwargs):
            return FakeResponse()

    def fake_run_case(_client, _base_url, case, _timeout):
        return {
            "id": case["id"],
            "description": case.get("description", ""),
            "tags": case.get("tags", []),
            "passed": True,
            "turns": [{"turn": 1, "passed": True, "elapsed_seconds": 0.1}],
        }

    checkpoints: list[dict] = []

    def capture_report(_path, report):
        checkpoints.append(copy.deepcopy(report))

    monkeypatch.setattr(evaluate_assistant.httpx, "Client", FakeClient)
    monkeypatch.setattr(evaluate_assistant, "run_case", fake_run_case)
    monkeypatch.setattr(evaluate_assistant, "write_report", capture_report)

    exit_code = evaluate_assistant.main(
        [
            "--target",
            "local",
            "--case",
            "guard_safety_ranking",
            "--case",
            "guard_presence_claim",
            "--output",
            str(tmp_path / "report.json"),
        ]
    )

    assert exit_code == 0
    assert [report["summary"]["cases"] for report in checkpoints] == [0, 1, 2, 2]
    assert checkpoints[1]["summary"]["cases_selected"] == 2
    assert checkpoints[1]["summary"]["turns_selected"] == 2
    assert checkpoints[1]["summary"]["turns"] == 1


def test_public_limit_templates_match_the_raised_hourly_posture() -> None:
    for path in (
        evaluate_assistant.REPO_ROOT / ".env.prod.example",
        evaluate_assistant.REPO_ROOT / ".env.tunnel.example",
    ):
        text = path.read_text()
        assert "MCA_RATE_LIMIT_ASSISTANT_PER_HOUR=60" in text
        assert "MCA_RATE_LIMIT_ASSISTANT_PER_IP_PER_HOUR=90" in text
        assert "MCA_RATE_LIMIT_ASSISTANT_GLOBAL_PER_DAY=500" in text
        assert "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY=2000000" in text


def test_public_templates_disable_temperature_for_reasoning_model_compatibility() -> None:
    for path in (
        evaluate_assistant.REPO_ROOT / ".env.prod.example",
        evaluate_assistant.REPO_ROOT / ".env.tunnel.example",
    ):
        text = path.read_text()
        assert "MCA_OPENAI_SEND_TEMPERATURE=false" in text
        assert "o-series and gpt-5-family models reject" in text

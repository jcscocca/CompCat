#!/usr/bin/env python3
"""Run CompCat's versioned behavioral corpus through the real assistant SSE endpoint."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = REPO_ROOT / "evals" / "assistant" / "v1.json"
DEFAULT_RESULTS = REPO_ROOT / "assistant-eval-results"
LOCAL_DEFAULT_URL = "http://127.0.0.1:8000"


class EvalConfigurationError(ValueError):
    pass


def load_corpus(path: Path) -> dict[str, Any]:
    raw = path.read_bytes()
    corpus = json.loads(raw)
    if corpus.get("schema_version") != 1:
        raise EvalConfigurationError("corpus schema_version must be 1")
    cases = corpus.get("cases")
    if not isinstance(cases, list) or not cases:
        raise EvalConfigurationError("corpus must contain at least one case")
    seen: set[str] = set()
    for case in cases:
        case_id = case.get("id")
        if not isinstance(case_id, str) or not case_id:
            raise EvalConfigurationError("every case needs a non-empty id")
        if case_id in seen:
            raise EvalConfigurationError(f"duplicate case id: {case_id}")
        seen.add(case_id)
        turns = case.get("turns")
        if not isinstance(turns, list) or not turns:
            raise EvalConfigurationError(f"{case_id}: turns must be a non-empty list")
        for index, turn in enumerate(turns, 1):
            if not isinstance(turn.get("prompt"), str) or not turn["prompt"].strip():
                raise EvalConfigurationError(f"{case_id} turn {index}: prompt is required")
            if not isinstance(turn.get("expect", {}), dict):
                raise EvalConfigurationError(f"{case_id} turn {index}: expect must be an object")
    corpus["sha256"] = hashlib.sha256(raw).hexdigest()
    return corpus


def select_cases(
    corpus: dict[str, Any], case_ids: list[str], tags: list[str]
) -> list[dict[str, Any]]:
    cases = corpus["cases"]
    known = {case["id"] for case in cases}
    missing = sorted(set(case_ids) - known)
    if missing:
        raise EvalConfigurationError(f"unknown case id(s): {', '.join(missing)}")
    selected = [case for case in cases if not case_ids or case["id"] in case_ids]
    if tags:
        wanted = set(tags)
        selected = [case for case in selected if wanted.intersection(case.get("tags", []))]
    if not selected:
        raise EvalConfigurationError("case/tag filters selected no cases")
    return selected


def parse_sse(lines: Any) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    event_name: str | None = None
    data_lines: list[str] = []

    def dispatch() -> None:
        nonlocal event_name, data_lines
        if event_name is None and not data_lines:
            return
        raw = "\n".join(data_lines)
        try:
            data = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            data = {"raw": raw}
        events.append({"event": event_name or "message", "data": data})
        event_name = None
        data_lines = []

    for raw_line in lines:
        line = raw_line.rstrip("\r")
        if not line:
            dispatch()
        elif line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_lines.append(line.split(":", 1)[1].lstrip())
    dispatch()
    return events


def response_text(events: list[dict[str, Any]]) -> str:
    text = ""
    for event in events:
        data = event.get("data", {})
        if event.get("event") == "token":
            text += str(data.get("delta", ""))
        elif event.get("event") == "replace":
            text = str(data.get("text", ""))
    return text.strip()


def _is_subset(expected: Any, actual: Any) -> bool:
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(
            key in actual and _is_subset(value, actual[key]) for key, value in expected.items()
        )
    if isinstance(expected, list):
        return isinstance(actual, list) and len(expected) <= len(actual) and all(
            _is_subset(value, actual[index]) for index, value in enumerate(expected)
        )
    return expected == actual


def check_turn(
    events: list[dict[str, Any]], elapsed_s: float, expect: dict[str, Any]
) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    names = [event.get("event") for event in events]
    text = response_text(events)
    errors = [event for event in events if event.get("event") == "error"]
    tools = [event.get("data", {}) for event in events if event.get("event") == "tool"]

    def add(name: str, passed: bool, detail: str) -> None:
        checks.append({"name": name, "passed": passed, "detail": detail})

    add("terminal_done", bool(names) and names[-1] == "done", f"last event: {names[-1:]}")
    add("no_error", not errors, errors[0].get("data", {}) if errors else "no error event")
    if not expect.get("allow_empty_response", False):
        add("nonempty_response", bool(text), f"response length: {len(text)}")

    expected_tool = expect.get("tool_name", "*")
    actual_tool_names = [str(tool.get("tool_name", "")) for tool in tools]
    if expected_tool is None:
        add("tool_name", not tools, f"expected none; got {actual_tool_names}")
    elif expected_tool != "*":
        allowed = [expected_tool] if isinstance(expected_tool, str) else expected_tool
        add(
            "tool_name",
            len(actual_tool_names) == 1 and actual_tool_names[0] in allowed,
            f"expected {allowed}; got {actual_tool_names}",
        )

    if "tool_arguments" in expect:
        actual_arguments = tools[0].get("arguments", {}) if len(tools) == 1 else {}
        add(
            "tool_arguments",
            len(tools) == 1 and _is_subset(expect["tool_arguments"], actual_arguments),
            f"expected subset {expect['tool_arguments']}; got {actual_arguments}",
        )

    flags = re.IGNORECASE | re.DOTALL
    patterns_any = expect.get("response_regex_any", [])
    if patterns_any:
        matched = [pattern for pattern in patterns_any if re.search(pattern, text, flags)]
        add("response_regex_any", bool(matched), f"matched: {matched}")
    for pattern in expect.get("response_regex_all", []):
        add(
            f"response_regex:{pattern}",
            bool(re.search(pattern, text, flags)),
            f"pattern {'matched' if re.search(pattern, text, flags) else 'did not match'}",
        )
    for pattern in expect.get("response_not_regex", []):
        add(
            f"response_not_regex:{pattern}",
            not re.search(pattern, text, flags),
            f"forbidden pattern {'matched' if re.search(pattern, text, flags) else 'absent'}",
        )
    if "max_seconds" in expect:
        limit = float(expect["max_seconds"])
        add("max_seconds", elapsed_s <= limit, f"{elapsed_s:.2f}s <= {limit:.2f}s")
    return checks


def run_turn(
    client: httpx.Client,
    base_url: str,
    payload: dict[str, Any],
    timeout_s: float,
) -> tuple[list[dict[str, Any]], float, int]:
    started = time.monotonic()
    with client.stream(
        "POST",
        f"{base_url}/assistant/chat",
        json=payload,
        headers={"Accept": "text/event-stream"},
        timeout=httpx.Timeout(timeout_s, connect=15.0),
    ) as response:
        status = response.status_code
        if status != 200:
            body = response.read().decode(errors="replace")[:1000]
            events = [{"event": "http_error", "data": {"status": status, "body": body}}]
        else:
            events = parse_sse(response.iter_lines())
    return events, time.monotonic() - started, status


def run_case(
    client: httpx.Client,
    base_url: str,
    case: dict[str, Any],
    timeout_s: float,
) -> dict[str, Any]:
    history: list[dict[str, str]] = []
    turns: list[dict[str, Any]] = []
    for index, turn in enumerate(case["turns"], 1):
        history.append({"role": "user", "content": turn["prompt"]})
        payload: dict[str, Any] = {
            "messages": history,
            "dashboard_state": turn.get("dashboard_state", case.get("dashboard_state", {})),
        }
        result_context = turn.get("latest_result_context", case.get("latest_result_context"))
        if result_context is not None:
            payload["latest_result_context"] = result_context
        try:
            events, elapsed_s, status = run_turn(client, base_url, payload, timeout_s)
        except (httpx.HTTPError, TimeoutError) as exc:
            elapsed_s = 0.0
            status = 0
            events = [{"event": "client_error", "data": {"message": str(exc)}}]
        text = response_text(events)
        checks = check_turn(events, elapsed_s, turn.get("expect", {}))
        passed = all(check["passed"] for check in checks)
        turns.append(
            {
                "turn": index,
                "prompt": turn["prompt"],
                "passed": passed,
                "elapsed_seconds": round(elapsed_s, 3),
                "http_status": status,
                "response": text,
                "tool_names": [
                    event.get("data", {}).get("tool_name")
                    for event in events
                    if event.get("event") == "tool"
                ],
                "event_names": [event.get("event") for event in events],
                "checks": checks,
            }
        )
        history.append({"role": "assistant", "content": text or "[No response]"})
    return {
        "id": case["id"],
        "description": case.get("description", ""),
        "tags": case.get("tags", []),
        "passed": all(turn["passed"] for turn in turns),
        "turns": turns,
    }


def load_baseline(path: Path) -> dict[str, Any]:
    baseline = json.loads(path.read_text(encoding="utf-8"))
    if baseline.get("schema_version") != 1 or not isinstance(baseline.get("cases"), list):
        raise EvalConfigurationError("baseline must be a schema-version 1 evaluation report")
    return baseline


def compare_baseline(
    report: dict[str, Any], baseline: dict[str, Any], path: Path
) -> dict[str, Any]:
    prior = {case["id"]: case for case in baseline.get("cases", [])}
    changes: list[dict[str, Any]] = []
    for case in report["cases"]:
        old = prior.get(case["id"])
        if old is None:
            changes.append({"id": case["id"], "change": "new_case"})
            continue
        old_times = [turn["elapsed_seconds"] for turn in old.get("turns", [])]
        new_times = [turn["elapsed_seconds"] for turn in case.get("turns", [])]
        changes.append(
            {
                "id": case["id"],
                "change": "pass_state_changed" if old.get("passed") != case["passed"] else "same",
                "passed_before": old.get("passed"),
                "passed_now": case["passed"],
                "elapsed_seconds_before": round(sum(old_times), 3),
                "elapsed_seconds_now": round(sum(new_times), 3),
            }
        )
    return {"path": str(path), "changes": changes}


def build_report(
    *,
    target: str,
    base_url: str,
    corpus_path: Path,
    corpus_sha256: str,
    started_at: datetime,
    finished_at: datetime,
    results: list[dict[str, Any]],
    selected_cases: int,
    selected_turns: int,
    baseline: dict[str, Any] | None = None,
    baseline_path: Path | None = None,
) -> dict[str, Any]:
    completed_turns = sum(len(result.get("turns", [])) for result in results)
    report: dict[str, Any] = {
        "schema_version": 1,
        "target": target,
        "base_url": base_url,
        "corpus": str(corpus_path),
        "corpus_sha256": corpus_sha256,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_seconds": round((finished_at - started_at).total_seconds(), 3),
        "summary": {
            "cases": len(results),
            "passed": sum(result["passed"] for result in results),
            "failed": sum(not result["passed"] for result in results),
            "turns": completed_turns,
            "cases_selected": selected_cases,
            "turns_selected": selected_turns,
        },
        "cases": results,
    }
    if baseline is not None and baseline_path is not None:
        report["baseline"] = compare_baseline(report, baseline, baseline_path)
    return report


def write_report(path: Path, report: dict[str, Any]) -> None:
    """Atomically persist a checkpoint using UTF-8 on every platform.

    Windows otherwise inherits a legacy code page such as CP-1252, which cannot encode all
    punctuation a model may return (for example U+202F NARROW NO-BREAK SPACE).
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(
        json.dumps(report, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    temporary.replace(path)


def resolve_base_url(args: argparse.Namespace) -> str:
    if args.base_url:
        return args.base_url.rstrip("/")
    env_name = "COMPCAT_EVAL_LOCAL_URL" if args.target == "local" else "COMPCAT_EVAL_GROQ_URL"
    configured = os.environ.get(env_name, "").strip()
    if configured:
        return configured.rstrip("/")
    if args.target == "local":
        return LOCAL_DEFAULT_URL
    raise EvalConfigurationError(
        "--target groq requires --base-url or COMPCAT_EVAL_GROQ_URL; this prevents an "
        "accidental quota-consuming production run"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("local", "groq"), default="local")
    parser.add_argument("--base-url", help="CompCat app origin; provider is configured by that app")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--case", action="append", default=[], dest="case_ids")
    parser.add_argument("--tag", action="append", default=[], dest="tags")
    parser.add_argument("--timeout", type=float, default=420.0, help="per-turn timeout in seconds")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--baseline", type=Path, help="prior JSON report to compare")
    parser.add_argument("--dry-run", action="store_true", help="validate and list without requests")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        corpus = load_corpus(args.corpus)
        cases = select_cases(corpus, args.case_ids, args.tags)
        base_url = resolve_base_url(args)
        baseline = load_baseline(args.baseline) if args.baseline else None
        if args.timeout <= 0:
            raise EvalConfigurationError("--timeout must be positive")
    except (OSError, json.JSONDecodeError, EvalConfigurationError) as exc:
        print(f"configuration error: {exc}", file=sys.stderr)
        return 2

    request_count = sum(len(case["turns"]) for case in cases)
    print(f"target={args.target} app={base_url} cases={len(cases)} turns={request_count}")
    for case in cases:
        print(f"  {case['id']}: {case.get('description', '')}")
    if args.dry_run:
        return 0
    if args.target == "groq":
        print("Groq run confirmed: these turns consume hosted request/token quota.")

    started_at = datetime.now(UTC)
    output = args.output
    if output is None:
        stamp = started_at.strftime("%Y%m%dT%H%M%SZ")
        output = DEFAULT_RESULTS / f"{args.target}-{stamp}.json"
    results: list[dict[str, Any]] = []

    def checkpoint() -> dict[str, Any]:
        report = build_report(
            target=args.target,
            base_url=base_url,
            corpus_path=args.corpus,
            corpus_sha256=corpus["sha256"],
            started_at=started_at,
            finished_at=datetime.now(UTC),
            results=results,
            selected_cases=len(cases),
            selected_turns=request_count,
            baseline=baseline,
            baseline_path=args.baseline,
        )
        write_report(output, report)
        return report

    try:
        # Fail early on an unwritable destination, then preserve every completed case. A full
        # ThinkPad run can take tens of minutes and should survive Ctrl+C, a terminal closure,
        # or a later provider failure without losing the earlier evidence.
        report = checkpoint()
        with httpx.Client(follow_redirects=True) as client:
            session_response = client.post(f"{base_url}/sessions", timeout=30.0)
            session_response.raise_for_status()
            for case in cases:
                print(f"\n[{case['id']}] running", flush=True)
                result = run_case(client, base_url, case, args.timeout)
                results.append(result)
                status = "PASS" if result["passed"] else "FAIL"
                elapsed = sum(turn["elapsed_seconds"] for turn in result["turns"])
                print(f"[{case['id']}] {status} ({elapsed:.1f}s)", flush=True)
                for turn in result["turns"]:
                    if not turn["passed"]:
                        for check in turn["checks"]:
                            if not check["passed"]:
                                print(f"  - {check['name']}: {check['detail']}")
                report = checkpoint()
    except httpx.HTTPError as exc:
        print(f"connection/session error: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"report error: {exc}", file=sys.stderr)
        return 2

    # Refresh the finish time once after the final console output/checkpoint work.
    try:
        report = checkpoint()
    except OSError as exc:
        print(f"report error: {exc}", file=sys.stderr)
        return 2
    print(
        f"\n{report['summary']['passed']}/{report['summary']['cases']} cases passed; "
        f"report: {output}"
    )
    return 0 if report["summary"]["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Live end-to-end smoke test for the CompCat dashboard.

Drives the running instance through all major endpoints and prints PASS/FAIL
per step, exiting non-zero on any hard failure.

Config (env vars):
  COMPCAT_URL  Base URL of the running instance. Default: http://localhost:8080

Assumptions:
  - The instance is already running and crime data is already ingested.
  - A session cookie is established on /sessions and reused for all later calls.
"""
from __future__ import annotations

import http.cookiejar
import json
import os
import sys
import urllib.error
import urllib.request
from typing import Any

BASE_URL: str = os.environ.get("COMPCAT_URL", "http://localhost:8080").rstrip("/")

# --------------------------------------------------------------------------- #
# Results tracking
# --------------------------------------------------------------------------- #

_results: list[tuple[str, str, str | None]] = []  # (label, PASS|FAIL|WARN, detail)


def _record(label: str, status: str, detail: str | None = None) -> None:
    _results.append((label, status, detail))
    marker = {"PASS": "[PASS]", "FAIL": "[FAIL]", "WARN": "[WARN]"}.get(status, f"[{status}]")
    line = f"  {marker} {label}"
    if detail:
        line += f" — {detail}"
    print(line)


def _pass(label: str, detail: str | None = None) -> None:
    _record(label, "PASS", detail)


def _fail(label: str, detail: str | None = None) -> None:
    _record(label, "FAIL", detail)


def _warn(label: str, detail: str | None = None) -> None:
    _record(label, "WARN", detail)


# --------------------------------------------------------------------------- #
# HTTP helpers
# --------------------------------------------------------------------------- #

_cookie_jar = http.cookiejar.CookieJar()
_opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_cookie_jar))


def _request(
    method: str,
    path: str,
    body: Any = None,
    content_type: str = "application/json",
) -> tuple[int, bytes, dict[str, str]]:
    """Return (status_code, body_bytes, headers_dict). Never raises on HTTP errors."""
    url = BASE_URL + path
    data: bytes | None = None
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", content_type)
    try:
        with _opener.open(req) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read(), dict(exc.headers)
    except urllib.error.URLError:
        # Connection-level error — re-raise so callers treat it as hard fail.
        raise


def _get(path: str) -> tuple[int, bytes, dict[str, str]]:
    return _request("GET", path)


def _post(path: str, body: Any = None) -> tuple[int, bytes, dict[str, str]]:
    return _request("POST", path, body)


def _json(body_bytes: bytes) -> Any:
    return json.loads(body_bytes.decode())


# --------------------------------------------------------------------------- #
# Steps
# --------------------------------------------------------------------------- #


def step1_health() -> bool:
    label = "Step 1 — GET /health"
    try:
        status, _, _ = _get("/health")
    except urllib.error.URLError as exc:
        _fail(label, f"connection error: {exc}")
        return False
    if status == 200:
        _pass(label)
        return True
    _fail(label, f"HTTP {status}")
    return False


def step2_session() -> bool:
    label = "Step 2 — POST /sessions (capture cookie)"
    try:
        status, body, _ = _post("/sessions")
    except urllib.error.URLError as exc:
        _fail(label, f"connection error: {exc}")
        return False
    if status == 200:
        _pass(label)
        return True
    _fail(label, f"HTTP {status} body={body[:200]!r}")
    return False


def step3_places() -> tuple[str | None, str | None]:
    """Returns (id1, id2) or (None, None) on failure."""
    place1 = {
        "display_label": "Smoke Pike-1st",
        "latitude": 47.6090,
        "longitude": -122.3380,
        "visit_count": 5,
    }
    place2 = {
        "display_label": "Smoke 3rd-Pine",
        "latitude": 47.6113,
        "longitude": -122.3378,
        "visit_count": 4,
    }
    label1 = "Step 3a — POST /places (place 1)"
    try:
        status, body, _ = _post("/places", place1)
    except urllib.error.URLError as exc:
        _fail(label1, f"connection error: {exc}")
        return None, None
    if status not in (200, 201):
        _fail(label1, f"HTTP {status} body={body[:200]!r}")
        return None, None
    id1 = _json(body).get("id")
    _pass(label1, f"id={id1}")

    label2 = "Step 3b — POST /places (place 2)"
    try:
        status, body, _ = _post("/places", place2)
    except urllib.error.URLError as exc:
        _fail(label2, f"connection error: {exc}")
        return id1, None
    if status not in (200, 201):
        _fail(label2, f"HTTP {status} body={body[:200]!r}")
        return id1, None
    id2 = _json(body).get("id")
    _pass(label2, f"id={id2}")
    return id1, id2


def step4_analyze(id1: str) -> bool:
    label = "Step 4 — POST /dashboard/analyze"
    body = {
        "place_ids": [id1],
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2026-06-30",
        "radii_m": [250],
        "offense_category": None,
    }
    try:
        status, resp_body, _ = _post("/dashboard/analyze", body)
    except urllib.error.URLError as exc:
        _fail(label, f"connection error: {exc}")
        return False
    if status == 200:
        _pass(label)
        return True
    _fail(label, f"HTTP {status} body={resp_body[:200]!r}")
    return False


def step5_neighborhood(id1: str) -> bool:
    label = "Step 5 — POST /dashboard/neighborhood"
    body = {
        "place_ids": [id1],
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2026-06-30",
        "radii_m": [250],
        "offense_category": None,
    }
    try:
        status, resp_body, _ = _post("/dashboard/neighborhood", body)
    except urllib.error.URLError as exc:
        _fail(label, f"connection error: {exc}")
        return False
    if status != 200:
        _fail(label, f"HTTP {status} body={resp_body[:200]!r}")
        return False
    data = _json(resp_body)
    places = data.get("places")
    if not places or not isinstance(places, list):
        _fail(label, f"places list missing or empty: {data!r}")
        return False
    first = places[0]
    if "decision" not in first:
        _fail(label, f"first place has no 'decision' key: {first!r}")
        return False
    decision = first.get("decision")
    rate_ratio = first.get("rate_ratio")
    detail = f"decision={decision!r}"
    if rate_ratio is not None:
        detail += f" rate_ratio={rate_ratio}"
    _pass(label, detail)
    return True


def step6_provenance(id1: str) -> bool:
    label_a = "Step 6a — POST /dashboard/analyze (PROPERTY filter)"
    body_prop = {
        "place_ids": [id1],
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2026-06-30",
        "radii_m": [250],
        "offense_category": "PROPERTY",
    }
    try:
        status, resp_body, _ = _post("/dashboard/analyze", body_prop)
    except urllib.error.URLError as exc:
        _fail(label_a, f"connection error: {exc}")
        return False
    if status != 200:
        _fail(label_a, f"HTTP {status} body={resp_body[:200]!r}")
        return False
    _pass(label_a)

    label_b = "Step 6b — GET /dashboard/summary (provenance check)"
    try:
        status, resp_body, _ = _get("/dashboard/summary")
    except urllib.error.URLError as exc:
        _fail(label_b, f"connection error: {exc}")
        return False
    if status != 200:
        _fail(label_b, f"HTTP {status} body={resp_body[:200]!r}")
        return False
    data = _json(resp_body)

    # Structural check
    if "totals" not in data or "crime_summaries" not in data:
        _fail(label_b, f"missing totals or crime_summaries keys: {list(data)!r}")
        return False

    totals = data["totals"]
    crime_summaries = data["crime_summaries"]

    # Provenance check: the summary must scope to the latest analysis run
    # (PROPERTY filter). It must NOT mix rows from the earlier null-filter run.
    # Every row that carries an offense_category must be "PROPERTY".
    has_non_property = any(
        row.get("offense_category") not in (None, "PROPERTY")
        for row in crime_summaries
        if isinstance(row, dict)
    )
    if has_non_property:
        _fail(
            label_b,
            "crime_summaries contains rows from a different offense_category run "
            "(provenance isolation failed)",
        )
        return False

    # Print totals for visibility.
    _pass(label_b, f"totals={totals!r} summaries={len(crime_summaries)}")
    return True


def step7_compare(id1: str, id2: str) -> bool:
    label = "Step 7 — POST /dashboard/compare"
    body = {
        "place_ids": [id1, id2],
        "analysis_start_date": "2024-01-01",
        "analysis_end_date": "2026-06-30",
        "radius_m": 250,
        "offense_category": None,
    }
    try:
        status, resp_body, _ = _post("/dashboard/compare", body)
    except urllib.error.URLError as exc:
        _fail(label, f"connection error: {exc}")
        return False
    if status == 200:
        _pass(label)
        return True
    _fail(label, f"HTTP {status} body={resp_body[:200]!r}")
    return False


def step8_export_csv() -> bool:
    label = "Step 8 — GET /exports/tableau/place-summary.csv"
    try:
        status, body, _ = _get("/exports/tableau/place-summary.csv")
    except urllib.error.URLError as exc:
        _fail(label, f"connection error: {exc}")
        return False
    if status != 200:
        _fail(label, f"HTTP {status}")
        return False
    text = body.decode(errors="replace")
    first_line = text.split("\n")[0] if text else ""
    # A CSV header has commas; a minimal check is that the first line is non-empty.
    if not first_line.strip():
        _fail(label, "body appears empty / no header line")
        return False
    _pass(label, f"header={first_line[:80]!r}")
    return True


def step9_assistant(id1: str) -> bool:
    label = "Step 9 — POST /assistant/chat (SSE stream)"
    body = {
        "messages": [{"role": "user", "content": "What do you see for my selected place?"}],
        "dashboard_state": {
            "selected_place_ids": [id1],
            "analysis_start_date": "2024-01-01",
            "analysis_end_date": "2026-06-30",
            "radii_m": [250],
            "offense_category": None,
            "offense_subcategory": None,
            "nibrs_group": None,
        },
    }
    url = BASE_URL + "/assistant/chat"
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", "text/event-stream")

    try:
        with _opener.open(req) as resp:
            if resp.status != 200:
                _fail(label, f"HTTP {resp.status}")
                return False
            # Read the SSE stream line by line.
            event_type: str | None = None
            saw_done = False
            saw_content = False  # token or tool event
            error_detail: str | None = None

            raw = resp.read().decode(errors="replace")
    except urllib.error.HTTPError as exc:
        _fail(label, f"HTTP {exc.code} body={exc.read()[:200]!r}")
        return False
    except urllib.error.URLError as exc:
        _fail(label, f"connection error: {exc}")
        return False

    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("event:"):
            event_type = line[len("event:"):].strip()
        elif line.startswith("data:"):
            data_str = line[len("data:"):].strip()
            if event_type == "done":
                saw_done = True
            elif event_type in ("token", "tool"):
                saw_content = True
            elif event_type == "error":
                try:
                    err_data = json.loads(data_str)
                    error_detail = err_data.get("message", data_str)
                except json.JSONDecodeError:
                    error_detail = data_str
            event_type = None  # reset for next pair

    if error_detail is not None:
        _warn(label, f"assistant returned error (LLM endpoint may be down): {error_detail}")
        return True  # soft — model stack may not be running

    if not saw_done:
        _fail(label, "stream ended without a 'done' event")
        return False

    if not saw_content:
        _fail(label, "stream had no 'token' or 'tool' event before done")
        return False

    _pass(label, "stream completed with content + done event")
    return True


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #


def main() -> int:
    print(f"CompCat live smoke test  →  {BASE_URL}")
    print("-" * 60)

    hard_failures: list[str] = []

    def run(label: str, ok: bool) -> None:
        if not ok:
            hard_failures.append(label)

    # Step 1
    if not step1_health():
        hard_failures.append("Step 1")
        print("\n[ABORT] Cannot reach the instance. Stopping early.")
        _print_summary(hard_failures)
        return 1

    # Step 2 — session (all later steps need the cookie)
    if not step2_session():
        hard_failures.append("Step 2")
        print("\n[ABORT] Could not establish session. Stopping early.")
        _print_summary(hard_failures)
        return 1

    # Step 3 — places
    id1, id2 = step3_places()
    if id1 is None:
        hard_failures.append("Step 3a")
    if id2 is None:
        hard_failures.append("Step 3b")

    # Steps 4–9 require at least place 1.
    if id1 is not None:
        run("Step 4", step4_analyze(id1))
        run("Step 5", step5_neighborhood(id1))
        run("Step 6", step6_provenance(id1))
        if id2 is not None:
            run("Step 7", step7_compare(id1, id2))
        else:
            _warn("Step 7", "skipped — place 2 creation failed")
        run("Step 8", step8_export_csv())
        run("Step 9", step9_assistant(id1))
    else:
        for s in ("Step 4", "Step 5", "Step 6", "Step 7", "Step 8", "Step 9"):
            _warn(s, "skipped — place creation failed")

    _print_summary(hard_failures)
    return 1 if hard_failures else 0


def _print_summary(hard_failures: list[str]) -> None:
    print("-" * 60)
    total = len(_results)
    passed = sum(1 for _, s, _ in _results if s == "PASS")
    failed = sum(1 for _, s, _ in _results if s == "FAIL")
    warned = sum(1 for _, s, _ in _results if s == "WARN")
    print(
        f"Summary: {passed}/{total} PASS  {failed} FAIL  {warned} WARN"
        + ("  ← HARD FAILURES: " + ", ".join(hard_failures) if hard_failures else "  ← ALL CLEAR")
    )


if __name__ == "__main__":
    sys.exit(main())

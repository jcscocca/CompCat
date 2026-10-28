from __future__ import annotations

import runpy
from pathlib import Path

import pytest

_MODULE = runpy.run_path(str(Path(__file__).resolve().parents[1] / "scripts/ci_browser_report.py"))
_VALIDATE = _MODULE["validate_reports"]


def _inventory(count: int) -> dict:
    return {"suites": [{"suites": [{"specs": [{"tests": [{} for _ in range(count)]}]}]}]}


def _report(count: int, **changes) -> dict:
    return {"stats": {"expected": count, "unexpected": 0, "skipped": 0, "flaky": 0, **changes}}


@pytest.mark.parametrize("count", [38, 39, 80])
def test_complete_inventory_including_new_cases_is_required(count: int) -> None:
    state = {"ExitCode": 0, "OOMKilled": False}
    assert _VALIDATE(_inventory(count), _report(count), state) == count


@pytest.mark.parametrize("count", [0, 1, 37])
def test_existing_browser_coverage_cannot_disappear(count: int) -> None:
    with pytest.raises(ValueError, match="all 38"):
        _VALIDATE(_inventory(count), _report(count), {"ExitCode": 0, "OOMKilled": False})


@pytest.mark.parametrize("changes", [{"expected": 37}, {"expected": 37, "skipped": 1},
                                    {"expected": 37, "unexpected": 1}])
def test_partial_skipped_or_failed_results_do_not_pass(changes: dict) -> None:
    with pytest.raises(ValueError):
        _VALIDATE(_inventory(38), _report(38, **changes), {"ExitCode": 0, "OOMKilled": False})


def test_original_retry_policy_is_preserved_in_the_report() -> None:
    state = {"ExitCode": 0, "OOMKilled": False}
    assert _VALIDATE(_inventory(38), _report(37, flaky=1), state) == 38


@pytest.mark.parametrize("state", [{"ExitCode": 1, "OOMKilled": False},
                                 {"ExitCode": 0, "OOMKilled": True}])
def test_container_failure_is_not_a_product_pass(state: dict) -> None:
    with pytest.raises(ValueError, match="container"):
        _VALIDATE(_inventory(38), _report(38), state)

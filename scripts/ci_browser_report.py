"""Validate complete browser inventory and results without changing the test suite."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def inventory_case_count(suite: dict) -> int:
    return sum(len(spec.get("tests", [])) for spec in suite.get("specs", [])) + sum(
        inventory_case_count(child) for child in suite.get("suites", [])
    )


def validate_reports(inventory: dict, report: dict, container: dict) -> int:
    count = inventory_case_count(inventory)
    if count < 38:
        raise ValueError("Browser inventory must retain all 38 existing cases")
    stats = report["stats"]
    for name in ("expected", "unexpected", "skipped", "flaky"):
        if type(stats[name]) is not int or stats[name] < 0:
            raise ValueError("Invalid browser case counts")
    if container["ExitCode"] != 0 or container["OOMKilled"]:
        raise ValueError("Browser container did not complete successfully")
    if stats["unexpected"] or stats["skipped"]:
        raise ValueError("Every collected browser case must pass without being skipped")
    if stats["expected"] + stats["flaky"] != count:
        raise ValueError("Browser results do not cover the complete collected inventory")
    return count


def main() -> None:
    inventory_path, report_path, state_path, log_path = map(Path, sys.argv[1:])
    inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    report = json.loads(report_path.read_text(encoding="utf-8"))
    container = json.loads(state_path.read_text(encoding="utf-8"))
    count = validate_reports(inventory, report, container)
    owner = f"{os.environ['GITHUB_RUN_ID']}-{os.environ['GITHUB_RUN_ATTEMPT']}"
    if f"COMPCAT_BROWSER_PROFILE_OK {owner}" not in log_path.read_text(encoding="utf-8"):
        raise ValueError("Browser profile owner was not preserved")
    print("COMPCAT_BROWSER_COMPLETE " + json.dumps(report["stats"]))
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as summary:
        summary.write(
            f"All {count} collected browser cases passed in a private container; "
            f"{report['stats']['flaky']} flaky. Source {os.environ['COMPCAT_CI_SOURCE_SHA']}.\n"
        )


if __name__ == "__main__":
    main()

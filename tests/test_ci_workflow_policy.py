"""Protect retirement-event isolation and the complete CI gate after queue changes."""
from __future__ import annotations

from pathlib import Path

import yaml

_ROOT = Path(__file__).resolve().parents[1]
_NORMAL = "github.event_name != 'pull_request_target' && github.event.action != 'closed'"


def _workflow() -> dict:
    # BaseLoader retains GitHub's `on` spelling instead of YAML 1.1's boolean alias.
    return yaml.load((_ROOT / ".github/workflows/ci.yml").read_text(), Loader=yaml.BaseLoader)


def _commands(job: dict) -> list[str]:
    return [step["run"] for step in job["steps"] if "run" in step]


def test_only_fixed_retirement_summary_can_run_on_trusted_closure() -> None:
    workflow = _workflow()
    assert workflow["on"]["pull_request_target"]["types"] == ["closed"]
    # Drafts already run every gate, so ready_for_review would repeat the same head.
    assert workflow["on"]["pull_request"]["types"] == ["opened", "synchronize", "reopened"]
    assert workflow["on"]["push"]["branches"] == ["main"]
    assert workflow["permissions"] == {"contents": "read"}
    control = workflow["jobs"]["retire-closed-pr"]
    assert control["if"] == (
        "github.event_name == 'pull_request_target' && github.event.action == 'closed'"
    )
    assert len(control["steps"]) == 1
    assert "uses" not in control["steps"][0]
    assert "${{" not in control["steps"][0]["run"]
    assert "Closed PR: previous ci run retired" in control["steps"][0]["run"]
    for name, job in workflow["jobs"].items():
        if name != "retire-closed-pr":
            assert job["if"] == _NORMAL


def test_manual_acceptance_is_independent_of_pr_and_main_supersession() -> None:
    workflow = _workflow()
    assert "workflow_dispatch" in workflow["on"]
    concurrency = workflow["concurrency"]
    assert "github.event_name == 'workflow_dispatch'" in concurrency["group"]
    assert "format('ci-manual-{0}-{1}', github.run_id, github.run_attempt)" in concurrency["group"]
    assert "github.event.pull_request.number || github.ref" in concurrency["group"]
    assert concurrency["cancel-in-progress"] == "${{ github.event_name != 'workflow_dispatch' }}"


def test_browser_waits_after_all_other_required_checks_without_dropping_them() -> None:
    jobs = _workflow()["jobs"]
    assert set(jobs) == {
        "retire-closed-pr", "backend", "backend-postgres", "frontend-unit", "frontend", "docker"
    }
    assert set(jobs["frontend"]["needs"]) == {
        "backend", "backend-postgres", "frontend-unit", "docker"
    }
    assert jobs["frontend"]["concurrency"] == {
        "group": "thinkpad-compcat-browser", "cancel-in-progress": "false", "queue": "max"
    }
    assert "ruff check ." in _commands(jobs["backend"])
    assert "pytest tests -q" in _commands(jobs["backend"])
    assert "alembic upgrade head" in _commands(jobs["backend-postgres"])
    assert "pytest tests/test_postgres_smoke.py tests/test_migrations.py -q" in _commands(
        jobs["backend-postgres"]
    )
    assert "npm test -- --maxWorkers=2" in _commands(jobs["frontend-unit"])
    assert "npm run build" in _commands(jobs["frontend-unit"])
    assert "npx playwright install chromium" in _commands(jobs["frontend"])
    assert (
        'flock "$HOME/.cache/thinkpad-actions-browser.lock" npm run test:visual -- --workers=1'
        in _commands(jobs["frontend"])
    )
    docker_steps = {step.get("name") for step in jobs["docker"]["steps"]}
    assert {
        "Build production image",
        "Import, migrate, boot, and probe the Python 3.14 production image",
        "Verify ops entry points without network or live data",
        "Production overlay publishes only the Caddy edge",
        "Ingest sidecar renders only under the ops profile",
    } <= docker_steps


def test_jobs_bound_resource_use_and_never_upload_automatic_artifacts() -> None:
    workflow = _workflow()
    assert all(workflow["env"][key] == "2" for key in (
        "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS",
        "GOMAXPROCS", "RAYON_NUM_THREADS", "UV_THREADPOOL_SIZE",
    ))
    for job in workflow["jobs"].values():
        assert 0 < int(job["timeout-minutes"]) <= 30
        for step in job["steps"]:
            assert not step.get("uses", "").startswith("actions/upload-artifact@")
            if step.get("uses", "").startswith("actions/checkout@"):
                assert step["with"]["persist-credentials"] == "false"

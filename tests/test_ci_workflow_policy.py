"""Protect retirement-event isolation and the complete CI gate after queue changes."""
from __future__ import annotations

import json
from pathlib import Path

import yaml

_ROOT = Path(__file__).resolve().parents[1]
_NORMAL = (
    "github.event_name != 'pull_request_target' && github.event.action != 'closed'"
    " && (github.event_name != 'pull_request'"
    " || github.event.pull_request.head.repo.full_name == github.repository)"
)


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
        if name not in {"retire-closed-pr", "untrusted-fork"}:
            assert job["if"] == _NORMAL


def test_manual_acceptance_is_independent_of_pr_and_main_supersession() -> None:
    workflow = _workflow()
    assert "workflow_dispatch" in workflow["on"]
    concurrency = workflow["concurrency"]
    assert "github.event_name == 'workflow_dispatch'" in concurrency["group"]
    assert "format('ci-manual-{0}-{1}', github.run_id, github.run_attempt)" in concurrency["group"]
    assert "github.event.pull_request.number || github.ref" in concurrency["group"]
    assert concurrency["cancel-in-progress"] == "${{ github.event_name != 'workflow_dispatch' }}"


def test_every_code_executing_job_refuses_fork_heads_before_allocating_a_worker() -> None:
    code_jobs = {name: job for name, job in _workflow()["jobs"].items()
                 if any("uses" in step for step in job["steps"])}
    assert set(code_jobs) == {"backend", "backend-postgres", "frontend-unit", "frontend", "docker"}
    for job in code_jobs.values():
        assert job["if"] == _NORMAL
        assert "github.event.pull_request.head.repo.full_name == github.repository" in job["if"]


def test_fork_policy_fails_closed_using_only_a_fixed_message() -> None:
    control = _workflow()["jobs"]["untrusted-fork"]
    assert control["if"] == (
        "github.event_name == 'pull_request'"
        " && github.event.pull_request.head.repo.full_name != github.repository"
    )
    assert len(control["steps"]) == 1
    assert "uses" not in control["steps"][0]
    command = control["steps"][0]["run"]
    assert "${{" not in command and "$" not in command
    assert "Fork heads cannot execute on self-hosted runners" in command
    assert command.rstrip().endswith("exit 1")


def test_browser_waits_after_all_other_required_checks_without_dropping_them() -> None:
    jobs = _workflow()["jobs"]
    assert set(jobs) == {
        "retire-closed-pr", "untrusted-fork", "backend", "backend-postgres", "frontend-unit",
        "frontend", "docker"
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
    assert "bash scripts/ci_browser_container.sh" in _commands(jobs["frontend"])
    assert not any("flock" in command for command in _commands(jobs["frontend"]))
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


def test_browser_image_matches_the_lock_and_keeps_the_complete_isolated_suite() -> None:
    lock = json.loads((_ROOT / "frontend/package-lock.json").read_text())
    version = lock["packages"]["node_modules/@playwright/test"]["version"]
    image = (_ROOT / "ci/browser.Dockerfile").read_text()
    entry = (_ROOT / "scripts/ci_browser_entry.sh").read_text()
    runner = (_ROOT / "scripts/ci_browser_container.sh").read_text()
    assert f"playwright:v{version}-noble@sha256:" in image
    assert "node:22.23.3-bookworm-slim@sha256:" in image
    assert "npm run test:visual -- --workers=1 --reporter=line,json" in entry
    assert "npx playwright test --list --reporter=json" in entry
    assert "--grep" not in entry and "--project" not in entry and "--update-snapshots" not in entry
    for flag in (
        "--init", "--cpus 2", "--memory 8g", "--shm-size 2g", "--ipc private", "--network none"
    ):
        assert flag in runner
    assert "--publish" not in runner and "--volume" not in runner and "--mount" not in runner
    assert "--tmpfs /home/probe:" in runner and "--tmpfs /tmp:" in runner
    assert "trap cleanup_owned EXIT" in runner
    assert "docker container inspect --format '{{.Id}}'" in runner
    assert runner.index('compcat.ci.run') < runner.index('docker stop')
    assert runner.index('compcat.ci.attempt') < runner.index('docker stop')
    assert runner.index('compcat.ci.kind') < runner.index('docker stop')
    assert '"$RUNNER_TEMP/compcat-ci-browser-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"' in runner
    assert "/tmp/compcat-ci-browser" not in runner
    assert 'ci_browser_storage.py" remove' in runner

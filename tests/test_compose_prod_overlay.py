from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_BASE = _ROOT / "docker-compose.yml"
_PROD = _ROOT / "docker-compose.prod.yml"

_TEST_PASSWORD = "ci-not-a-real-password"
_TEST_DATABASE_URL = f"postgresql+psycopg://mca:{_TEST_PASSWORD}@db:5432/mca"

_DEPLOY = _ROOT / "deploy"
_CRONTAB = _DEPLOY / "ingest-cron.crontab"
_JOB = _DEPLOY / "ingest-daily.sh"
_DOCKERFILE = _DEPLOY / "ingest-cron.Dockerfile"


def test_overlay_documents_its_own_usage_and_sources_secrets_from_env() -> None:
    text = _PROD.read_text(encoding="utf-8")
    assert "docker compose -f docker-compose.yml -f docker-compose.prod.yml" in text
    # !reset, not an empty list: Compose merges sequences, so only the tag drops the base publish.
    assert "ports: !reset []" in text
    assert "${POSTGRES_PASSWORD:?" in text
    assert "${MCA_DATABASE_URL:?" in text
    # db, api, and the ops-profile ingest sidecar.
    assert text.count("restart: unless-stopped") == 3
    assert ":-" not in text  # no dev fallback defaults anywhere in the production overlay


def _compose_available() -> bool:
    if shutil.which("docker") is None:
        return False
    probe = subprocess.run(
        ["docker", "compose", "version"], capture_output=True, text=True, check=False
    )
    return probe.returncode == 0


def _render(
    env_overrides: dict[str, str],
    drop: tuple[str, ...] = (),
    profiles: tuple[str, ...] = (),
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.update(env_overrides)
    for name in drop:
        env.pop(name, None)
    profile_args: list[str] = []
    for profile in profiles:
        profile_args += ["--profile", profile]
    return subprocess.run(
        [
            "docker",
            "compose",
            # /dev/null so a stray repo-root .env cannot supply the required variables.
            "--env-file",
            "/dev/null",
            *profile_args,
            "-f",
            str(_BASE),
            "-f",
            str(_PROD),
            "config",
        ],
        cwd=_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


def test_rendered_overlay_publishes_no_postgres_port() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {
            "POSTGRES_PASSWORD": _TEST_PASSWORD,
            "MCA_DATABASE_URL": _TEST_DATABASE_URL,
            "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY": "0",
        }
    )
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    assert 'published: "5432"' not in rendered
    assert 'published: "8000"' in rendered  # the app is still reachable
    assert rendered.count("restart: unless-stopped") == 2


def test_rendered_overlay_refuses_to_render_without_a_db_password() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {
            "MCA_DATABASE_URL": _TEST_DATABASE_URL,
            "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY": "0",
        },
        drop=("POSTGRES_PASSWORD",),
    )
    assert result.returncode != 0
    assert "POSTGRES_PASSWORD" in result.stderr


def test_rendered_overlay_requires_an_explicit_token_budget() -> None:
    # The production spend posture must be stated, not inherited silently (0 disables).
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {"POSTGRES_PASSWORD": _TEST_PASSWORD, "MCA_DATABASE_URL": _TEST_DATABASE_URL},
        drop=("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY",),
    )
    assert result.returncode != 0
    assert "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY" in result.stderr


# ---------- nightly ingest sidecar (ops profile) ----------

_BASE_ENV = {
    "POSTGRES_PASSWORD": _TEST_PASSWORD,
    "MCA_DATABASE_URL": _TEST_DATABASE_URL,
    "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY": "0",
}


def test_sidecar_is_absent_without_the_ops_profile() -> None:
    # Dev/demo and the plain prod stack must be unaffected by the automation.
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(_BASE_ENV, drop=("MCA_ADMIN_INGEST_TOKEN",))
    assert result.returncode == 0, result.stderr
    assert "ingest-cron" not in result.stdout
    # Only db and api restart in the default rendering.
    assert result.stdout.count("restart: unless-stopped") == 2


def test_sidecar_renders_under_the_ops_profile() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {**_BASE_ENV, "MCA_ADMIN_INGEST_TOKEN": "ci-not-a-real-token"}, profiles=("ops",)
    )
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    assert "ingest-cron" in rendered
    assert "MCA_ADMIN_INGEST_TOKEN: ci-not-a-real-token" in rendered
    assert "TZ: America/Los_Angeles" in rendered
    assert "target: /etc/crontabs/root" in rendered
    assert 'published: "5432"' not in rendered  # the overlay's own guarantee still holds


def test_crontab_fires_once_daily_and_holds_no_secret() -> None:
    text = _CRONTAB.read_text(encoding="utf-8")
    schedule_lines = [
        line for line in text.splitlines() if line.strip() and not line.startswith("#")
    ]
    assert len(schedule_lines) == 1
    assert schedule_lines[0].startswith("10 3 * * *")
    # The token is an env reference resolved at run time; it is never written into this file.
    assert "MCA_ADMIN_INGEST_TOKEN" not in text
    assert "X-Admin-Token" not in text
    assert text.endswith("\n")  # crond ignores a crontab without a trailing newline


def test_job_script_posts_every_layer_in_order_using_the_env_token() -> None:
    text = _JOB.read_text(encoding="utf-8")
    order = [
        text.index("seattle_spd_crime"),
        text.index("seattle_spd_arrests"),
        text.index("seattle_spd_911"),
    ]
    assert order == sorted(order)
    assert '"X-Admin-Token: ${MCA_ADMIN_INGEST_TOKEN}"' in text
    assert "http://api:8000" in text  # reached over the compose network, not the host
    assert "mode=backfill" in text  # incremental from the stored watermark
    assert "-sS --fail" in text  # non-2xx cause lands in docker logs


def test_sidecar_image_is_pinned_and_installs_tzdata() -> None:
    text = _DOCKERFILE.read_text(encoding="utf-8")
    assert "FROM alpine:3.22" in text
    # tzdata is load-bearing: without it musl resolves TZ=America/Los_Angeles to UTC.
    assert "tzdata" in text
    assert "curl" in text

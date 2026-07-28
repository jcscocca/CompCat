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


def test_overlay_documents_its_own_usage_and_sources_secrets_from_env() -> None:
    text = _PROD.read_text(encoding="utf-8")
    assert "docker compose -f docker-compose.yml -f docker-compose.prod.yml" in text
    # !reset, not an empty list: Compose merges sequences, so only the tag drops the base publish.
    assert "ports: !reset []" in text
    assert "${POSTGRES_PASSWORD:?" in text
    assert "${MCA_DATABASE_URL:?" in text
    assert text.count("restart: unless-stopped") == 2
    assert ":-" not in text  # no dev fallback defaults anywhere in the production overlay


def _compose_available() -> bool:
    if shutil.which("docker") is None:
        return False
    probe = subprocess.run(
        ["docker", "compose", "version"], capture_output=True, text=True, check=False
    )
    return probe.returncode == 0


def _render(
    env_overrides: dict[str, str], drop: tuple[str, ...] = ()
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.update(env_overrides)
    for name in drop:
        env.pop(name, None)
    return subprocess.run(
        [
            "docker",
            "compose",
            # /dev/null so a stray repo-root .env cannot supply the required variables.
            "--env-file",
            "/dev/null",
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
        {"POSTGRES_PASSWORD": _TEST_PASSWORD, "MCA_DATABASE_URL": _TEST_DATABASE_URL}
    )
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    assert 'published: "5432"' not in rendered
    assert 'published: "8000"' in rendered  # the app is still reachable
    assert rendered.count("restart: unless-stopped") == 2


def test_rendered_overlay_refuses_to_render_without_a_db_password() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render({"MCA_DATABASE_URL": _TEST_DATABASE_URL}, drop=("POSTGRES_PASSWORD",))
    assert result.returncode != 0
    assert "POSTGRES_PASSWORD" in result.stderr

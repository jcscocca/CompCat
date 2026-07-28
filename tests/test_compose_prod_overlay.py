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
_CADDYFILE = _DEPLOY / "Caddyfile"
_BACKUP = _DEPLOY / "backup-daily.sh"


def test_overlay_documents_its_own_usage_and_sources_secrets_from_env() -> None:
    text = _PROD.read_text(encoding="utf-8")
    assert "docker compose -f docker-compose.yml -f docker-compose.prod.yml" in text
    # !reset, not an empty list: Compose merges sequences, so only the tag drops the base publish.
    # Twice now — db (never published) and api (Caddy is the only ingress in production).
    assert text.count("ports: !reset []") == 2
    assert "${POSTGRES_PASSWORD:?" in text
    assert "${MCA_DATABASE_URL:?" in text
    # db, api, the ops-profile ingest sidecar, and caddy.
    assert text.count("restart: unless-stopped") == 4
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


def test_rendered_overlay_publishes_only_the_caddy_edge() -> None:
    # Production ingress is Caddy on 80/443 (+443/udp for HTTP/3) and nothing else: neither
    # Postgres nor the app's own 8000 may be reachable from the host network.
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
    assert 'published: "8000"' not in rendered
    assert 'published: "80"' in rendered
    assert 'published: "443"' in rendered
    assert rendered.count("protocol: udp") == 1  # HTTP/3 on 443
    assert rendered.count("restart: unless-stopped") == 3  # db, api, caddy


def test_rendered_caddy_mounts_the_repo_caddyfile_read_only() -> None:
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
    assert "caddy:2-alpine" in rendered
    assert "target: /etc/caddy/Caddyfile" in rendered
    # Certificates and OCSP staples survive a container replacement.
    assert "target: /data" in rendered
    assert "target: /config" in rendered


def test_caddyfile_terminates_tls_for_the_registered_domain_and_proxies_the_api() -> None:
    text = _CADDYFILE.read_text(encoding="utf-8")
    assert "compcat.app {" in text
    assert "reverse_proxy api:8000" in text
    assert "encode gzip" in text
    # Nothing else: no extra directives to review, no TLS overrides that would disable ACME.
    directives = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and not line.strip().startswith("#") and line.strip() != "}"
    ]
    assert directives == ["compcat.app {", "encode gzip", "reverse_proxy api:8000"]


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
    # Only db, api and caddy restart in the default rendering.
    assert result.stdout.count("restart: unless-stopped") == 3


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
    assert "target: /etc/ingest/backup.sh" in rendered
    assert "target: /backups" in rendered
    assert "POSTGRES_PASSWORD" in rendered
    assert 'published: "5432"' not in rendered  # the overlay's own guarantee still holds


def test_crontab_fires_ingest_then_backup_nightly_and_holds_no_secret() -> None:
    text = _CRONTAB.read_text(encoding="utf-8")
    schedule_lines = [
        line for line in text.splitlines() if line.strip() and not line.startswith("#")
    ]
    assert len(schedule_lines) == 2
    # Ingest at 03:10, backup at 03:40 — the dump captures the night's fresh data, and the
    # half-hour gap keeps the two jobs off each other's database connections.
    assert schedule_lines[0].startswith("10 3 * * *")
    assert "/etc/ingest/run.sh" in schedule_lines[0]
    assert schedule_lines[1].startswith("40 3 * * *")
    assert "/etc/ingest/backup.sh" in schedule_lines[1]
    # Secrets are env references resolved at run time; never written into this file.
    assert "MCA_ADMIN_INGEST_TOKEN" not in text
    assert "X-Admin-Token" not in text
    assert "POSTGRES_PASSWORD" not in text
    assert text.endswith("\n")  # crond ignores a crontab without a trailing newline


def test_backup_script_dumps_over_the_network_and_refuses_without_a_password() -> None:
    text = _BACKUP.read_text(encoding="utf-8")
    assert "pg_dump" in text
    assert "-Fc" in text  # custom format: pg_restore can select/parallelize
    assert "-h db -U mca -d mca" in text  # over the compose network, not a local socket
    assert "/backups" in text
    # Refuse-and-log rather than writing an unusable empty dump.
    assert "POSTGRES_PASSWORD" in text
    assert "refusing to run" in text


def test_backup_script_keeps_seven_daily_and_four_weekly_archives() -> None:
    text = _BACKUP.read_text(encoding="utf-8")
    assert "KEEP_DAILY=${KEEP_DAILY:-7}" in text
    assert "KEEP_WEEKLY=${KEEP_WEEKLY:-4}" in text
    # Sunday's dump is additionally linked under a weekly- name, so pruning the dailies
    # cannot take the weekly set with it.
    assert "weekly" in text
    assert "date +%u" in text


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


def test_sidecar_image_is_pinned_and_installs_its_tools() -> None:
    text = _DOCKERFILE.read_text(encoding="utf-8")
    assert "FROM alpine:3.22" in text
    # tzdata is load-bearing: without it musl resolves TZ=America/Los_Angeles to UTC.
    assert "tzdata" in text
    assert "curl" in text
    # Client major must match the postgres:16 server image in docker-compose.yml.
    assert "postgresql16-client" in text

"""Render assertions for the named-tunnel posture (docs/DEPLOY-TUNNEL.md).

Sibling of test_compose_prod_overlay.py: the tunnel overlay is layered on top of the
production one, so everything that file guarantees still applies. What is checked here is only
what the third file changes — the edge (no Caddy, no published port, cloudflared instead) and
the isolation of the public instance from the other two compose projects on the same machine.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_BASE = _ROOT / "docker-compose.yml"
_PROD = _ROOT / "docker-compose.prod.yml"
_TUNNEL = _ROOT / "docker-compose.tunnel.yml"
_ENV_EXAMPLE = _ROOT / ".env.tunnel.example"
_START = _ROOT / "scripts" / "public" / "start-public.ps1"
_STOP = _ROOT / "scripts" / "public" / "stop-public.ps1"

_PROJECT = "compcat-public"
_TEST_PASSWORD = "ci-not-a-real-password"
_TEST_DATABASE_URL = f"postgresql+psycopg://mca:{_TEST_PASSWORD}@db:5432/mca"

_BASE_ENV = {
    "POSTGRES_PASSWORD": _TEST_PASSWORD,
    "MCA_DATABASE_URL": _TEST_DATABASE_URL,
    "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY": "0",
    "MCA_RATE_LIMIT_ENABLED": "true",
    "CLOUDFLARE_TUNNEL_TOKEN": "ci-not-a-real-tunnel-token",
}


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
            "-p",
            _PROJECT,
            # /dev/null so a stray repo-root .env cannot supply the required variables.
            "--env-file",
            "/dev/null",
            *profile_args,
            "-f",
            str(_BASE),
            "-f",
            str(_PROD),
            "-f",
            str(_TUNNEL),
            "config",
        ],
        cwd=_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


def test_overlay_documents_its_own_three_file_invocation_and_the_project_name() -> None:
    text = _TUNNEL.read_text(encoding="utf-8")
    assert "-f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.tunnel.yml" in text
    # The project name is the isolation mechanism (own volumes, own network) against the
    # personal instance and the demo — it must be documented where the file is read.
    assert "-p compcat-public" in text
    assert "compcat-demo" in text
    assert ":-" not in text  # no dev fallback defaults in a production edge overlay


def test_caddy_is_parked_on_a_dead_profile_rather_than_silently_inherited() -> None:
    # Compose cannot delete a service an earlier file defined; the profile is the substitute,
    # and the reason has to survive in the file rather than only in review.
    text = _TUNNEL.read_text(encoding="utf-8")
    assert 'profiles: ["disabled"]' in text


def test_cloudflared_image_is_pinned_and_runs_the_named_tunnel() -> None:
    text = _TUNNEL.read_text(encoding="utf-8")
    assert "image: cloudflare/cloudflared:" in text
    assert "cloudflared:latest" not in text
    assert "tunnel --no-autoupdate run --token" in text
    assert "${CLOUDFLARE_TUNNEL_TOKEN:?" in text


def test_rendered_tunnel_stack_publishes_nothing_and_has_no_caddy() -> None:
    # The whole point of this posture: Cloudflare is reached by an OUTBOUND connection, so the
    # host binds no port at all — not 80/443 (no TLS edge here), not 8000, not 5432.
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(_BASE_ENV)
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    assert "caddy" not in rendered
    assert "published:" not in rendered
    assert "cloudflared" in rendered
    assert "cloudflare/cloudflared:" in rendered
    # db, api and cloudflared survive a reboot; the sidecar joins them under --profile ops.
    assert rendered.count("restart: unless-stopped") == 3


def test_rendered_tunnel_stack_refuses_to_render_without_the_tunnel_token() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(_BASE_ENV, drop=("CLOUDFLARE_TUNNEL_TOKEN",))
    assert result.returncode != 0
    assert "CLOUDFLARE_TUNNEL_TOKEN" in result.stderr


def test_rendered_tunnel_stack_keeps_the_ops_sidecar_behind_its_profile() -> None:
    # Same gate as the VPS posture: nightly ingest/backup/retention only with --profile ops.
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    without = _render(_BASE_ENV, drop=("MCA_ADMIN_INGEST_TOKEN",))
    assert without.returncode == 0, without.stderr
    assert "ingest-cron" not in without.stdout

    with_ops = _render(
        {**_BASE_ENV, "MCA_ADMIN_INGEST_TOKEN": "ci-not-a-real-token"}, profiles=("ops",)
    )
    assert with_ops.returncode == 0, with_ops.stderr
    rendered = with_ops.stdout
    assert "ingest-cron" in rendered
    assert "caddy" not in rendered  # the ops profile must not drag the edge back in
    assert "published:" not in rendered
    assert rendered.count("restart: unless-stopped") == 4  # + the sidecar


def test_rendered_tunnel_stack_caps_log_growth_on_cloudflared_too() -> None:
    # A tunnel that reconnects in a loop is chatty; unbounded json-file logs would fill the
    # laptop's disk and take the database down with them.
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {**_BASE_ENV, "MCA_ADMIN_INGEST_TOKEN": "ci-not-a-real-token"}, profiles=("ops",)
    )
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    # api, db, cloudflared and the ops sidecar — no caddy in this posture.
    assert rendered.count("driver: json-file") == 4
    assert rendered.count("max-size: 10m") == 4
    assert rendered.count('max-file: "5"') == 4


def test_public_instance_volumes_never_collide_with_the_personal_or_demo_projects() -> None:
    # The personal instance (project `compcat`) has real saved places and personal uploads
    # enabled; the demo is `compcat-demo`. The -p prefix is what keeps this stack's database
    # and backups separate from both.
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {**_BASE_ENV, "MCA_ADMIN_INGEST_TOKEN": "ci-not-a-real-token"}, profiles=("ops",)
    )
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    assert "name: compcat-public" in rendered
    assert "name: compcat-public_mca-postgres" in rendered
    assert "name: compcat-public_backups" in rendered
    assert "name: compcat_mca-postgres" not in rendered
    assert "name: compcat-demo_mca-postgres" not in rendered


def test_canonical_origin_reaches_the_frontend_build_through_the_tunnel_overlay() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render({**_BASE_ENV, "VITE_CANONICAL_ORIGIN": "https://compcat.app"})
    assert result.returncode == 0, result.stderr
    assert "VITE_CANONICAL_ORIGIN: https://compcat.app" in result.stdout


# ---------- the env posture ----------


def test_env_example_ships_the_public_posture_with_the_tunnel_token() -> None:
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    assert "MCA_ENVIRONMENT=production" in text
    assert "MCA_SESSION_COOKIE_SECURE=true" in text
    assert "MCA_RATE_LIMIT_ENABLED=true" in text
    assert "MCA_RATE_LIMIT_ASSISTANT_PER_IP_PER_HOUR=" in text
    assert "MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY=" in text
    assert "MCA_SESSION_DATA_RETENTION_DAYS=" in text
    assert "MCA_GEOCODER_CONTACT_EMAIL=" in text
    assert "VITE_CANONICAL_ORIGIN=https://compcat.app" in text
    assert "CLOUDFLARE_TUNNEL_TOKEN=__" in text  # placeholder, never a real token
    # Exposure stays shut on a public instance.
    assert "MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=false" in text
    assert "MCA_INTERNAL_TIER_ENABLED=false" in text
    # Claude primary, Groq failover — same pairing as the VPS posture.
    assert "MCA_LLM_PROVIDER=anthropic" in text
    assert "MCA_LLM_FALLBACK_BASE_URL=https://api.groq.com/openai/v1" in text
    assert "__run: openssl rand -hex 32__" in text  # fresh secrets, not inherited ones


def test_env_example_explains_why_proxy_headers_are_trusted_here_but_stripped_by_caddy() -> None:
    # The limiter reads CF-Connecting-IP first. Here Cloudflare IS the edge and sets it, so it
    # is authoritative; on the VPS the Caddyfile strips it because a client could forge it.
    # Getting that inverted is a silent single-rate-bucket-for-the-world bug, so the reasoning
    # is pinned to the file.
    text = _ENV_EXAMPLE.read_text(encoding="utf-8")
    assert "MCA_TRUST_PROXY_HEADERS=true" in text
    assert "CF-Connecting-IP" in text
    assert "Caddyfile" in text
    assert "header_up -CF-Connecting-IP" in text


# ---------- the bring-up scripts ----------


def test_start_script_uses_the_isolated_project_and_all_three_overlays() -> None:
    text = _START.read_text(encoding="utf-8")
    assert "'-p', 'compcat-public'" in text
    for overlay in ("docker-compose.yml", "docker-compose.prod.yml", "docker-compose.tunnel.yml"):
        assert f"'{overlay}'" in text
    assert "'--profile', 'ops'" in text
    assert "'--env-file', '.env.tunnel'" in text
    # No host port exists, so /health is probed from inside the api container.
    assert "exec -T api python -c" in text
    assert "urlopen('http://localhost:8000/health')" in text
    # Per-layer freshness backfill, same policy as scripts/start-compcat.ps1.
    for source in ("seattle_spd_crime", "seattle_spd_arrests", "seattle_spd_911"):
        assert source in text
    assert "mode=backfill" in text
    assert "https://compcat.app" in text


def test_start_script_states_the_isolation_from_the_personal_and_demo_instances() -> None:
    text = _START.read_text(encoding="utf-8")
    assert "compcat-public_mca-postgres" in text
    assert "compcat-demo" in text
    assert "MUST NEVER BE EXPOSED" in text


def test_stop_script_only_takes_down_the_public_project() -> None:
    text = _STOP.read_text(encoding="utf-8")
    assert "-p compcat-public" in text
    assert "docker-compose.tunnel.yml" in text
    assert "--env-file .env.tunnel" in text
    assert " down" in text
    assert "down -v" in text  # the destructive variant is documented, not run


# ---------- the runbook ----------

_RUNBOOK = _ROOT / "docs" / "DEPLOY-TUNNEL.md"


def test_runbook_carries_the_user_steps_and_the_honest_trade_offs() -> None:
    text = _RUNBOOK.read_text(encoding="utf-8")
    assert "USER STEPS" in text
    # The five steps only a human with a browser can do.
    assert "dash.cloudflare.com/sign-up" in text
    assert "compcat.app` as a zone" in text
    assert "nameservers" in text
    assert "Zero Trust" in text and "Tunnels" in text
    assert "cloudflared tunnel login" in text  # the CLI fallback if the dashboard wants a card
    assert "`api:8000`" in text  # the public hostname points at the compose service name
    # Trade-offs stated, not glossed.
    assert "What this trades" in text
    assert "pmtiles" in text.lower()
    assert "DEPLOY-VPS.md" in text  # the migration path stays documented


def test_deploy_docs_cross_link_the_two_public_runbooks() -> None:
    vps = (_ROOT / "docs" / "DEPLOY-VPS.md").read_text(encoding="utf-8")
    demo = (_ROOT / "docs" / "DEMO.md").read_text(encoding="utf-8")
    deploy = (_ROOT / "docs" / "DEPLOY.md").read_text(encoding="utf-8")
    index = (_ROOT / "docs" / "README.md").read_text(encoding="utf-8")
    assert "DEPLOY-TUNNEL.md" in vps
    assert "DEPLOY-TUNNEL.md" in demo
    assert "DEPLOY-TUNNEL.md" in deploy
    assert "DEPLOY-TUNNEL.md" in index

from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]
_SCRIPTS = _ROOT / "scripts"
_RUN_MODES = _ROOT / "docs" / "RUN-MODES.md"


def _read(relative_path: str) -> str:
    return (_SCRIPTS / relative_path).read_text(encoding="utf-8")


def test_personal_start_uses_an_explicit_isolated_project() -> None:
    text = _read("start-compcat.ps1")

    assert "PERSONAL CompCat stack" in text
    assert "'-p', 'compcat'" in text
    assert "'docker-compose.yml'" in text
    assert ".env.deploy" in text
    assert "compcat_mca-postgres" in text
    assert "MUST\n# NEVER be exposed" in text


def test_personal_start_rebuilds_by_default_and_supports_intentional_skips() -> None:
    text = _read("start-compcat.ps1")

    assert "[switch]$SkipPull" in text
    assert "[switch]$SkipBuild" in text
    assert "git pull --ff-only" in text
    assert "Compose up -d --build" in text
    assert "image always matches the checked-out revision" in text


def test_personal_stop_is_scoped_and_keeps_the_database() -> None:
    text = _read("stop-compcat.ps1")

    assert "'-p', 'compcat'" in text
    assert "docker @composeArgs down" in text
    assert "down -v" not in text
    assert "Database kept: compcat_mca-postgres" in text
    assert "[switch]$StopAnalyst" in text
    assert "compcat-public" in text


def test_public_thinkpad_launchers_name_the_persistent_tunnel_mode() -> None:
    start = _read("public/start-public.ps1")
    stop = _read("public/stop-public.ps1")

    assert "CompCat public instance (compcat-public)" in start
    assert "https://compcat.app via named tunnel" in start
    assert "no host ports" in start
    assert "this script does not pull" in start
    assert "'-p', 'compcat-public'" in start
    assert "'.env.tunnel'" in start

    assert "PUBLIC instance (project: compcat-public)" in stop
    assert "-p compcat-public" in stop
    assert "Volumes kept: compcat-public_mca-postgres" in stop


def test_vps_and_mac_launchers_cannot_be_mistaken_for_thinkpad_personal() -> None:
    vps_start = _read("prod/start-compcat.sh")
    vps_stop = _read("prod/stop-compcat.sh")
    dev = _read("dev.sh")

    assert "LINUX/VPS launcher, not a ThinkPad script" in vps_start
    assert "PUBLIC VPS instance" in vps_start
    assert ".env.prod" in vps_start
    assert "Caddy :80/:443" in vps_start
    assert "this script does not pull" in vps_start
    assert "PUBLIC VPS instance" in vps_stop

    assert "MAC DEVELOPMENT mode" in dev
    assert "Vite UI: http://127.0.0.1:5173" in dev
    assert "Nothing here needs the ThinkPad" in dev


def test_run_mode_chooser_covers_every_launcher_and_is_linked() -> None:
    run_modes = _RUN_MODES.read_text(encoding="utf-8")
    readme = (_ROOT / "README.md").read_text(encoding="utf-8")
    docs_index = (_ROOT / "docs" / "README.md").read_text(encoding="utf-8")
    deploy = (_ROOT / "docs" / "DEPLOY.md").read_text(encoding="utf-8")
    deploy_env = (_ROOT / ".env.deploy.example").read_text(encoding="utf-8")

    for launcher in (
        r"scripts\start-compcat.ps1",
        r"scripts\stop-compcat.ps1",
        r"scripts\public\start-public.ps1",
        "scripts/prod/start-compcat.sh",
        "scripts/dev.sh",
    ):
        assert launcher in run_modes

    for project in ("compcat_mca-postgres", "compcat-public"):
        assert project in run_modes

    assert "docs/RUN-MODES.md" in readme
    assert "(RUN-MODES.md)" in docs_index
    assert "(RUN-MODES.md)" in deploy
    assert r"pwsh -File scripts\start-compcat.ps1" in deploy
    assert r"pwsh -File scripts\start-compcat.ps1" in deploy_env

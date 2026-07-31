from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_SCRIPTS = _ROOT / "scripts"
_RUN_MODES = _ROOT / "docs" / "RUN-MODES.md"


def _read(relative_path: str) -> str:
    return (_SCRIPTS / relative_path).read_text(encoding="utf-8")


def test_powershell_launchers_are_ascii_safe_for_windows_powershell() -> None:
    """Windows PowerShell 5.1 misdecodes BOM-less UTF-8 punctuation as ANSI."""
    for path in sorted(_SCRIPTS.rglob("*.ps1")):
        try:
            path.read_bytes().decode("ascii")
        except UnicodeDecodeError as exc:
            relative_path = path.relative_to(_ROOT)
            raise AssertionError(f"{relative_path} contains non-ASCII text") from exc


@pytest.mark.skipif(shutil.which("pwsh") is None, reason="PowerShell is not installed")
def test_powershell_launchers_parse() -> None:
    for path in sorted(_SCRIPTS.rglob("*.ps1")):
        escaped_path = path.as_posix().replace("'", "''")
        command = (
            "$tokens = $null; $errors = $null; "
            f"[System.Management.Automation.Language.Parser]::ParseFile('{escaped_path}', "
            "[ref]$tokens, [ref]$errors) > $null; "
            "if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_ }; exit 1 }"
        )
        result = subprocess.run(
            ["pwsh", "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True,
            check=False,
            text=True,
        )
        relative_path = path.relative_to(_ROOT)
        assert result.returncode == 0, f"{relative_path}: {result.stderr or result.stdout}"


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
    assert "[switch]$SkipLlmPrewarm" in text
    assert "openai/gpt-oss-120b" in text
    assert "http://127.0.0.1:8080/v1/chat/completions" in text
    assert "-TimeoutSec 600" in text


def test_gpt_oss_installer_is_resumable_verified_and_scoped_to_personal_mode() -> None:
    text = _read("install-gpt-oss-120b.ps1")

    assert r"AI Models\Library\OpenAI\gpt-oss-120b" in text
    assert "gpt-oss-120b-MXFP4.gguf" in text
    assert "63387346208" in text
    assert "582bd40f6886200101f4c4ed9f25f3fe80cc14c86e9e2b37746cd8904a0c622d" in text
    assert "Get-FileHash" in text
    assert "--continue-at" in text
    assert 'Copy-Item -LiteralPath $ConfigPath -Destination $backupPath' in text
    assert "openai/gpt-oss-120b" in text
    assert "--n-cpu-moe 34" in text
    assert "$modelTtlSeconds = 3600" in text
    assert "$healthCheckTimeoutSeconds = 300" in text
    assert "^healthCheckTimeout:" in text
    assert "MCA_LLM_TIMEOUT_S' '300'" in text
    assert "MCA_ASSISTANT_NARRATION_ENABLED' 'true'" in text
    assert "[switch]$ActivateForCompCat" in text
    assert "scripts\\start-compcat.ps1" in text


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

    assert r"scripts\install-gpt-oss-120b.ps1" in run_modes

    for project in ("compcat_mca-postgres", "compcat-public"):
        assert project in run_modes

    assert "docs/RUN-MODES.md" in readme
    assert "(RUN-MODES.md)" in docs_index
    assert "(RUN-MODES.md)" in deploy
    assert r"pwsh -File scripts\start-compcat.ps1" in deploy
    assert r"pwsh -File scripts\start-compcat.ps1" in deploy_env

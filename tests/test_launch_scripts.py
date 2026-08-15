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


def _code(relative_path: str) -> str:
    """The script with comment lines stripped.

    Assertions about what a script *does* must not be satisfied - or broken - by prose that
    merely mentions the thing. These launchers carry long explanatory headers.
    """
    return "\n".join(
        line for line in _read(relative_path).splitlines() if not line.lstrip().startswith("#")
    )


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
    assert "validate_public_env.py --mode tunnel .env.tunnel" in start

    assert "PUBLIC instance (project: compcat-public)" in stop
    assert "-p compcat-public" in stop
    assert "Volumes kept: compcat-public_mca-postgres" in stop


def test_public_supervisor_is_scoped_validated_and_never_deploys() -> None:
    """ensure-public.ps1 runs unattended every few minutes, so it must not be able to ship code."""
    code = _code("public/ensure-public.ps1")

    assert "'-p', 'compcat-public'" in code
    assert "'.env.tunnel'" in code
    # The same posture gate as the manual launcher, and for a stronger reason.
    assert "validate_public_env.py --mode tunnel .env.tunnel" in code

    # A supervisor, not a deployer: it must never build an image, and it must never ingest -
    # that is the nightly sidecar's job, not something a 10-minute watchdog may kick off.
    assert "--build" not in code
    assert "Compose up -d" in code
    assert "admin/crime/ingest" not in code
    # Drift between the checkout and the running image is reported, never acted on.
    assert "Run start-public.ps1 to deploy the checkout." in code

    # End-to-end proof, not just a local health check: a healthy API behind a dead tunnel is
    # exactly the outage this is meant to catch.
    assert "https://compcat.app/health" in code
    assert "Compose restart cloudflared" in code


def test_public_supervisor_repairs_the_orphaned_socket_failure() -> None:
    """The 2026-08-13 outage: Docker Desktop cannot start while a stale AF_UNIX socket exists."""
    code = _code("public/ensure-public.ps1")

    # Both directories must be swept before every start attempt: each failed start leaves a fresh
    # orphan, so clearing only the one named in the newest crash never converges.
    assert "Docker\\run" in code
    assert "docker-secrets-engine" in code
    assert "remove (<HOME>[^:]+?): The file cannot be accessed" in code
    # Only zero-byte socket files may ever be relocated unattended.
    assert "$_.PSIsContainer -or $_.Length -gt 0" in code
    assert "Rename-Item -LiteralPath $dir -NewName $bak" in code


def test_public_autostart_installer_is_reversible_and_needs_no_elevation() -> None:
    code = _code("public/install-public-autostart.ps1")

    assert "[switch]$Uninstall" in code
    assert "Unregister-ScheduledTask" in code
    assert "$taskName = 'CompCat public site'" in code
    assert "ensure-public.ps1" in code
    # Interactive, because Docker Desktop cannot run as a service and lives in the desktop session.
    assert "-LogonType Interactive -RunLevel Limited" in code
    # Both triggers: the logon bring-up and the watchdog that covers everything logon cannot.
    assert "-AtLogOn" in code
    assert "-RepetitionInterval" in code
    assert "MultipleInstances IgnoreNew" in code


def test_public_vps_launcher_validates_its_env_before_starting() -> None:
    text = _read("prod/start-compcat.sh")

    validation = 'validate_public_env.py --mode vps "${ENV_FILE}"'
    assert validation in text
    assert text.index(validation) < text.index("compose up -d --build")


def test_freshness_probes_carry_the_session_cookie_by_hand() -> None:
    """A cookiejar silently breaks this probe in every production-like posture.

    `/dashboard/freshness` is session-scoped, and MCA_SESSION_COOKIE_SECURE is true in both
    .env.tunnel and .env.prod. urllib's HTTPCookieProcessor refuses to replay a Secure cookie
    over the plain-HTTP container loopback these probes must use, so the request answered 401:
    the tunnel launcher then backfilled every layer on every deploy, and the VPS launcher
    aborted under `set -e` after the site was already healthy.
    """
    for launcher in ("public/start-public.ps1", "prod/start-compcat.sh"):
        # Comments stripped: both scripts explain the cookiejar trap by name, and prose must
        # neither satisfy nor break an assertion about what the script actually does.
        code = _code(launcher)
        assert "http.cookiejar" not in code, f"{launcher} still relies on a cookiejar"
        assert "HTTPCookieProcessor" not in code, f"{launcher} still relies on a cookiejar"
        assert 'created.getheader("Set-Cookie", "").split(";", 1)[0]' in code
        assert 'headers={"Cookie": cookie}' in code
        # A session with no cookie must not be mistaken for a fresh dataset.
        assert "POST /sessions returned no session cookie" in code


def test_tunnel_launcher_refuses_to_guess_when_the_freshness_probe_fails() -> None:
    """Silence here is expensive: unknown freshness reads as maximally stale, and a full
    911-calls backfill is a rolling 24-month window."""
    code = _code("public/start-public.ps1")

    assert "if ($LASTEXITCODE -ne 0 -or -not $freshnessJson) {" in code
    assert "throw 'the freshness probe failed (see the error above)'" in code


def test_building_launchers_stamp_the_full_git_revision() -> None:
    personal = _read("start-compcat.ps1")
    tunnel = _read("public/start-public.ps1")
    vps = _read("prod/start-compcat.sh")

    assert "$env:BUILD_REVISION = (git rev-parse HEAD).Trim()" in personal
    assert personal.index("$env:BUILD_REVISION") < personal.index("Compose up -d --build")
    assert "$env:BUILD_REVISION = (git rev-parse HEAD).Trim()" in tunnel
    assert tunnel.index("$env:BUILD_REVISION") < tunnel.index("Compose up -d --build")
    assert "BUILD_REVISION=\"$(git rev-parse --verify 'HEAD^{commit}')\"" in vps
    assert vps.index("BUILD_REVISION=") < vps.index("compose up -d --build")
    assert '$servedRevision -ne $env:BUILD_REVISION' in tunnel
    assert '"${served_revision}" != "${BUILD_REVISION}"' in vps
    assert "Deployed revision mismatch" in tunnel
    assert "Deployed revision mismatch" in vps


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
        r"scripts\public\install-public-autostart.ps1",
        r"scripts\public\ensure-public.ps1",
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

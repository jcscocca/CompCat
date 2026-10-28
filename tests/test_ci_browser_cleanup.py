from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.skipif(os.name != "posix", reason="CI browser lifecycle uses the Linux Docker CLI")
@pytest.mark.parametrize("foreign", ["container", "image"])
def test_cleanup_refuses_foreign_owners_after_unique_name_recovery(tmp_path: Path, foreign: str):
    executable = tmp_path / "docker"
    log = tmp_path / "docker-calls.jsonl"
    executable.write_text(
        """#!/usr/bin/python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['FAKE_DOCKER_LOG'], 'a') as output:
    output.write(json.dumps(args) + '\\n')
foreign = os.environ['FOREIGN_OWNER']
if args[:2] == ['container', 'inspect']:
    if foreign == 'image': sys.exit(1)
    if '--format' in args: print('a' * 64)
elif args[:2] == ['image', 'inspect']:
    if foreign == 'container': sys.exit(1)
    if '--format' in args: print('a-different-run')
elif args and args[0] == 'inspect':
    if '--format' in args: print('a-different-run')
else:
    sys.exit(99)
""",
        encoding="utf-8",
    )
    executable.chmod(0o700)
    environment = dict(os.environ, PATH=f"{tmp_path}:{os.environ['PATH']}",
        RUNNER_TEMP=str(tmp_path), GITHUB_RUN_ID="990001", GITHUB_RUN_ATTEMPT="1",
        GITHUB_JOB="frontend", FAKE_DOCKER_LOG=str(log), FOREIGN_OWNER=foreign)
    result = subprocess.run(["bash", str(_ROOT / "scripts/ci_browser_container.sh"), "cleanup"],
                            env=environment, capture_output=True, text=True, check=False)
    assert result.returncode != 0
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    assert ["container", "inspect", "compcat-ci-browser-990001-1"] in calls
    assert not any(call[0] in {"stop", "rm", "run", "build", "cp"} for call in calls)
    assert not any(call[:2] == ["image", "rm"] for call in calls)


@pytest.mark.skipif(os.name != "posix", reason="CI browser lifecycle uses the Linux Docker CLI")
@pytest.mark.parametrize("diagnostics", ["valid", "bad-receipt", "link"])
def test_cleanup_decouples_owned_docker_resources_from_diagnostics(
    tmp_path: Path, diagnostics: str,
):
    executable = tmp_path / "docker"
    log = tmp_path / "docker-calls.jsonl"
    executable.write_text(
        """#!/usr/bin/python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ['FAKE_DOCKER_LOG'], 'a') as output:
    output.write(json.dumps(args) + '\\n')
if args[:2] == ['container', 'inspect']:
    if '--format' in args: print('a' * 64)
elif args[:2] == ['image', 'inspect'] or (args and args[0] == 'inspect'):
    if '--format' in args:
        template = args[args.index('--format') + 1]
        if 'compcat.ci.run' in template: print('990001')
        elif 'compcat.ci.attempt' in template: print('1')
        elif 'compcat.ci.kind' in template: print('browser')
        elif '.State' in template: print(json.dumps({'ExitCode': 0, 'OOMKilled': False}))
        else: sys.exit(98)
elif args[0] not in {'stop', 'rm', 'cp'} and args[:2] != ['image', 'rm']:
    sys.exit(99)
""",
        encoding="utf-8",
    )
    executable.chmod(0o700)
    environment = dict(os.environ, PATH=f"{tmp_path}:{os.environ['PATH']}",
        RUNNER_TEMP=str(tmp_path), GITHUB_RUN_ID="990001", GITHUB_RUN_ATTEMPT="1",
        GITHUB_JOB="frontend", FAKE_DOCKER_LOG=str(log))
    subprocess.run(["python3", str(_ROOT / "scripts/ci_browser_storage.py"), "prepare"],
                   env=environment, capture_output=True, text=True, check=True)
    current = tmp_path / "compcat-ci-browser-990001-1"
    (current / "test-results").mkdir()
    (current / "test-results" / "failure.png").write_bytes(b"diagnostic")
    other = tmp_path / "compcat-ci-browser-990002-1"
    other.mkdir()
    (other / "preserve.txt").write_text("other job", encoding="utf-8")
    if diagnostics == "bad-receipt":
        (current / "receipt.json").write_text('{"run":"foreign"}', encoding="utf-8")
    elif diagnostics == "link":
        (current / "foreign-link").symlink_to(other, target_is_directory=True)
    result = subprocess.run(["bash", str(_ROOT / "scripts/ci_browser_container.sh"), "cleanup"],
                            env=environment, capture_output=True, text=True, check=False)
    if diagnostics == "valid":
        assert result.returncode == 0, result.stderr
        assert not current.exists()
    else:
        assert result.returncode != 0
        assert (current / "test-results" / "failure.png").read_bytes() == b"diagnostic"
        assert "Refusing invalid diagnostics" in result.stderr
    assert (other / "preserve.txt").read_text(encoding="utf-8") == "other job"
    assert tmp_path.exists()
    calls = [json.loads(line) for line in log.read_text().splitlines()]
    assert ["stop", "--time", "3", "a" * 64] in calls
    assert ["rm", "-f", "a" * 64] in calls
    assert ["image", "rm", "compcat-ci-browser:990001-1"] in calls
    assert not any("prune" in call for call in calls)
    if diagnostics != "valid":
        assert not any(call[0] == "cp" for call in calls)

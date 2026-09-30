"""Smoke orchestration must propagate failures and clean up its disposable container.

The actual locked-runtime/import/migration/HTTP assertions run against Docker in CI.
These hermetic tests cover failure paths without requiring a local Docker daemon.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("mode", ["healthy", "import-failed", "boot-failed"])
def test_image_smoke_failure_and_cleanup(tmp_path: Path, mode: str) -> None:
    docker = tmp_path / "docker"
    calls_file = tmp_path / "calls.jsonl"
    docker.write_text(
        """#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
with open(os.environ["SMOKE_CALLS"], "a") as output:
    output.write(json.dumps(args) + "\\n")
mode = os.environ["SMOKE_MODE"]
if args[0] == "run" and "--entrypoint" in args:
    sys.exit(1 if mode == "import-failed" else 0)
if args[0] == "exec":
    sys.exit(0 if mode == "healthy" else 1)
if args[0] == "inspect":
    print("false")
if args[0] == "logs":
    print("startup failed")
""",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    result = subprocess.run(
        ["sh", str(_ROOT / "scripts" / "smoke-production-image.sh"), "test-image"],
        env={
            **os.environ,
            "PATH": f"{tmp_path}{os.pathsep}{os.environ['PATH']}",
            "SMOKE_CALLS": str(calls_file),
            "SMOKE_MODE": mode,
        },
        capture_output=True,
        text=True,
        timeout=10,
        check=False,
    )
    calls = [json.loads(line) for line in calls_file.read_text().splitlines()]
    assert result.returncode == (0 if mode == "healthy" else 1)
    boots = [args for args in calls if args[0] == "run" and "--detach" in args]
    removals = [args for args in calls if args[0] == "rm"]
    if mode == "import-failed":
        assert not boots
        assert not removals
    else:
        assert len(boots) == len(removals) == 1
        container = boots[0][boots[0].index("--name") + 1]
        assert removals[0] == ["rm", "--force", container]
    if mode == "boot-failed":
        assert "startup failed" in result.stdout

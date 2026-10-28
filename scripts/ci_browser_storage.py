"""Keep browser diagnostics inside this job's runner-managed temporary directory."""
from __future__ import annotations

import json
import os
import re
import shutil
import stat
import sys
from pathlib import Path


def owned_directory(root: Path, run: str, attempt: str) -> Path:
    if not re.fullmatch(r"[1-9][0-9]*", run) or not re.fullmatch(r"[1-9][0-9]*", attempt):
        raise ValueError("Browser diagnostics require numeric run and attempt identities")
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or root.resolve() != root or info.st_uid != os.getuid():
        raise ValueError("Browser diagnostics require an owned, real RUNNER_TEMP directory")
    return root / f"compcat-ci-browser-{run}-{attempt}"


def receipt(run: str, attempt: str) -> dict:
    return {"schema": "compcat-ci-browser/v1", "repository": "jcscocca/CompCat",
            "job": "frontend", "run": run, "attempt": attempt}


def verify(root: Path, run: str, attempt: str) -> Path:
    leaf = owned_directory(root, run, attempt)
    info = leaf.lstat()
    if (not stat.S_ISDIR(info.st_mode) or leaf.resolve() != leaf
            or info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) != 0o700):
        raise ValueError("Browser diagnostics directory is not privately owned")
    for target in leaf.rglob("*"):
        info = target.lstat()
        if info.st_uid != os.getuid() or not (
            stat.S_ISREG(info.st_mode) or stat.S_ISDIR(info.st_mode)
        ):
            raise ValueError("Browser diagnostics contain an unowned or special path")
    if json.loads((leaf / "receipt.json").read_text(encoding="utf-8")) != receipt(run, attempt):
        raise ValueError("Browser diagnostics receipt does not match this job")
    return leaf


def prepare(root: Path, run: str, attempt: str) -> Path:
    leaf = owned_directory(root, run, attempt)
    leaf.mkdir(mode=0o700)
    with (leaf / "receipt.json").open("x", encoding="utf-8") as output:
        json.dump(receipt(run, attempt), output)
        output.write("\n")
    return verify(root, run, attempt)


def remove(root: Path, run: str, attempt: str) -> None:
    leaf = owned_directory(root, run, attempt)
    if not leaf.exists() and not leaf.is_symlink():
        return
    shutil.rmtree(verify(root, run, attempt))


def main() -> None:
    if os.environ.get("GITHUB_JOB") != "frontend":
        raise ValueError("Browser diagnostics are reserved for the frontend job")
    root = Path(os.environ["RUNNER_TEMP"])
    run, attempt = os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"]
    operation = {"prepare": prepare, "verify": verify, "remove": remove}[sys.argv[1]]
    result = operation(root, run, attempt)
    if result is not None:
        print(result)


if __name__ == "__main__":
    main()

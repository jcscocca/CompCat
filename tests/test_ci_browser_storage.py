from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "ci_browser_storage", Path(__file__).resolve().parents[1] / "scripts/ci_browser_storage.py"
)
assert _SPEC and _SPEC.loader
storage = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(storage)
pytestmark = pytest.mark.skipif(os.name != "posix", reason="Linux runner ownership checks")


def test_removes_only_receipted_current_job_and_is_idempotent(tmp_path: Path) -> None:
    other = storage.prepare(tmp_path, "990002", "1")
    current = storage.prepare(tmp_path, "990001", "2")
    (current / "test-results").mkdir()
    (current / "test-results" / "failure.png").write_bytes(b"diagnostic")
    unrelated = tmp_path / "another-job.txt"
    unrelated.write_text("preserve", encoding="utf-8")
    storage.remove(tmp_path, "990001", "2")
    storage.remove(tmp_path, "990001", "2")
    assert not current.exists()
    assert other.exists() and unrelated.read_text(encoding="utf-8") == "preserve"
    assert tmp_path.exists()


def test_refuses_mismatched_receipt_without_deleting(tmp_path: Path) -> None:
    current = storage.prepare(tmp_path, "990001", "1")
    wrong = storage.receipt("990002", "1")
    (current / "receipt.json").write_text(json.dumps(wrong), encoding="utf-8")
    with pytest.raises(ValueError, match="receipt"):
        storage.remove(tmp_path, "990001", "1")
    assert current.exists()


@pytest.mark.parametrize("target", ["leaf", "child"])
def test_refuses_links_without_touching_their_target(tmp_path: Path, target: str) -> None:
    outside = tmp_path / "unrelated"
    outside.mkdir()
    marker = outside / "preserve.txt"
    marker.write_text("preserve", encoding="utf-8")
    if target == "leaf":
        (tmp_path / "compcat-ci-browser-990001-1").symlink_to(outside, target_is_directory=True)
    else:
        leaf = storage.prepare(tmp_path, "990001", "1")
        (leaf / "link").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        storage.remove(tmp_path, "990001", "1")
    assert marker.read_text(encoding="utf-8") == "preserve"


@pytest.mark.parametrize("run,attempt", [("../other", "1"), ("990001", "0"), ("", "1")])
def test_refuses_non_numeric_path_identity(tmp_path: Path, run: str, attempt: str) -> None:
    with pytest.raises(ValueError, match="numeric"):
        storage.prepare(tmp_path, run, attempt)
    assert not list(tmp_path.iterdir())

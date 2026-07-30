from __future__ import annotations

from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]


def test_runtime_lock_is_committed_and_docker_installs_from_it() -> None:
    lock = (_ROOT / "requirements.lock").read_text(encoding="utf-8")
    dockerfile = (_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "--hash=sha256:" in lock
    assert "fastapi==" in lock
    assert "greenlet==" in lock
    assert "sqlalchemy==" in lock
    assert "COPY requirements.lock ./" in dockerfile
    assert "pip install --no-cache-dir --require-hashes -r requirements.lock" in dockerfile
    assert "pip install --no-cache-dir --no-deps ." in dockerfile


def test_make_install_remains_the_editable_developer_workflow() -> None:
    makefile = (_ROOT / "Makefile").read_text(encoding="utf-8")
    assert ".venv/bin/python -m pip install -e '.[dev]'" in makefile

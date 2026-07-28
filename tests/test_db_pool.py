"""Connection-pool posture per backend.

Postgres connections die between requests — the server restarts, a nightly backup bounces
it, an idle connection is reaped by a firewall. Without pre-ping the pool hands out the
dead connection and the request 500s. SQLite has no such pool to guard.
"""

from __future__ import annotations

import pytest

from app.db import configure_database, get_engine

_POSTGRES_URL = "postgresql+psycopg://mca:not-a-real-password@db:5432/mca"


@pytest.fixture(autouse=True)
def _restore_sqlite_engine(tmp_path):
    # configure_database swaps a module-level engine; put a throwaway SQLite one back so a
    # later test in the same process never inherits the Postgres engine built here.
    yield
    configure_database(f"sqlite+pysqlite:///{tmp_path / 'restore.sqlite3'}")


def test_postgres_engine_enables_pool_pre_ping():
    configure_database(_POSTGRES_URL)
    assert get_engine().pool._pre_ping is True


def test_sqlite_engine_keeps_its_connect_args():
    configure_database("sqlite+pysqlite:///:memory:")
    engine = get_engine()
    assert engine.dialect.name == "sqlite"
    assert engine.url.get_backend_name() == "sqlite"

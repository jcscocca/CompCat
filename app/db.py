from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


_engine = None
_session_local: sessionmaker[Session] | None = None


def _enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def configure_database(database_url: str | None = None) -> None:
    global _engine, _session_local
    url = database_url or get_settings().database_url
    if url.startswith("sqlite") and ":///" in url:
        sqlite_path = url.split(":///", 1)[1]
        if sqlite_path != ":memory:":
            Path(sqlite_path).parent.mkdir(parents=True, exist_ok=True)
    is_sqlite = url.startswith("sqlite")
    connect_args = {"check_same_thread": False} if is_sqlite else {}
    # pool_pre_ping on Postgres only: pooled connections die between requests (a server
    # restart, the nightly backup bouncing it, a firewall reaping an idle socket), and
    # without the ping the pool hands out the dead one and the request 500s. SQLite has no
    # such pool to guard, and the ping would just be overhead on a local file.
    pool_args = {} if is_sqlite else {"pool_pre_ping": True}
    _engine = create_engine(url, connect_args=connect_args, future=True, **pool_args)
    if is_sqlite:
        event.listen(_engine, "connect", _enable_sqlite_foreign_keys)
    _session_local = sessionmaker(_engine, autoflush=False, autocommit=False, future=True)


def get_engine():
    if _engine is None:
        configure_database()
    return _engine


def get_sessionmaker() -> sessionmaker[Session]:
    if _session_local is None:
        configure_database()
    return _session_local


def get_session() -> Iterator[Session]:
    session = get_sessionmaker()()
    try:
        yield session
    finally:
        session.close()


def init_db() -> None:
    from app import models  # noqa: F401

    engine = get_engine()
    # Dev/test (SQLite) bootstraps the schema with create_all. Production (Postgres) schema
    # is owned by Alembic (`alembic upgrade head` in the Docker CMD / `make migrate`), so we
    # do NOT also run create_all there — that would race migrations and leave alembic_version
    # unstamped, masking migration drift. (Existing Postgres deploys created via the old
    # create_all path need a one-time `alembic stamp head`; see docs/DEPLOY.md.)
    if engine.url.get_backend_name() == "sqlite":
        Base.metadata.create_all(bind=engine)

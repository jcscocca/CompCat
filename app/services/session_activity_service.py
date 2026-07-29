from __future__ import annotations

from datetime import datetime

from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models import SessionActivity, utc_now


def touch_session_activity(
    session: Session,
    user_id_hash: str,
    *,
    seen_at: datetime | None = None,
) -> None:
    """Upsert one pseudonymous identity's last successful create/resume timestamp."""
    seen_at = seen_at or utc_now()
    values = {"user_id_hash": user_id_hash, "last_seen_at": seen_at}
    dialect = session.get_bind().dialect.name
    if dialect == "postgresql":
        statement = postgresql_insert(SessionActivity).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[SessionActivity.user_id_hash],
            set_={"last_seen_at": seen_at},
        )
    elif dialect == "sqlite":
        statement = sqlite_insert(SessionActivity).values(**values)
        statement = statement.on_conflict_do_update(
            index_elements=[SessionActivity.user_id_hash],
            set_={"last_seen_at": seen_at},
        )
    else:
        existing = session.get(SessionActivity, user_id_hash)
        if existing is None:
            session.add(SessionActivity(**values))
        else:
            existing.last_seen_at = seen_at
        session.commit()
        return

    session.execute(statement)
    session.commit()

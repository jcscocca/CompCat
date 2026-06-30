"""Seed the database with the bundled synthetic 911 call dataset (app/data/seed_calls.csv),
tagged source_dataset="seattle_spd_911". Idempotent — re-running skips calls already present
(dedup is per-source). Demo data; real data comes from the Socrata ingest with
?source=seattle_spd_911 (see docs/DEPLOY.md).

    make seed-calls          # or: .venv/bin/python scripts/seed_calls.py
"""
from __future__ import annotations

from importlib import resources

from app.crime.seattle_socrata import load_calls_csv
from app.db import configure_database, get_sessionmaker, init_db
from app.services.crime_ingestion_service import ingest_crime_incidents


def main() -> int:
    configure_database()
    init_db()
    path = resources.files("app.data").joinpath("seed_calls.csv")
    incidents = load_calls_csv(path)
    with get_sessionmaker()() as session:
        result = ingest_crime_incidents(session, incidents)
    print(f"seeded from seed_calls.csv: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

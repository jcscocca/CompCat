"""Seed the database with the bundled synthetic dataset (app/data/seed_crime.csv) so a
fresh deploy renders dashboards instead of starting empty. Idempotent — re-running skips
incidents that are already present.

    make seed-crime        # or: .venv/bin/python scripts/seed_crime.py

This is demo data; real data comes from the Socrata ingest (see docs/DEPLOY.md).
"""
from __future__ import annotations

from importlib import resources

from app.crime.seattle_socrata import load_crime_csv
from app.db import configure_database, get_sessionmaker, init_db
from app.services.crime_ingestion_service import ingest_crime_incidents


def main() -> int:
    configure_database()
    init_db()
    path = resources.files("app.data").joinpath("seed_crime.csv")
    incidents = load_crime_csv(path)
    with get_sessionmaker()() as session:
        result = ingest_crime_incidents(session, incidents)
    print(f"seeded from seed_crime.csv: {result}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

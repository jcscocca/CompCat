"""Generate app/data/seed_crime.csv — a small, synthetic SPD-shaped dataset so a fresh
deploy renders meaningful dashboards and neighborhood baselines instead of being empty.

Deterministic (fixed RNG seed) so regenerating produces a stable, reviewable diff. This is
NOT real data: incidents are clustered around real Seattle police beats with plausible
coordinates, dates, and offense mixes purely so the analysis surfaces have something to
show. Real data comes from the Socrata ingest (see docs/DEPLOY.md).

    .venv/bin/python scripts/generate_seed_crime.py --out app/data/seed_crime.csv
"""
from __future__ import annotations

import argparse
import csv
import random
from datetime import datetime, timedelta

HEADER = [
    "report_number", "offense_id", "offense_start_datetime", "offense_end_datetime",
    "report_datetime", "crime_against_category", "offense_parent_group", "offense",
    "nibrs_group_a_b", "precinct", "sector", "beat", "mcpp", "100_block_address",
    "longitude", "latitude",
]

# (beat, precinct, sector, mcpp, lat, lon) — beats that exist in
# app/data/seattle_police_beats_2018_area.csv, so neighborhood baselines resolve.
CLUSTERS = [
    ("K1", "West", "K", "DOWNTOWN COMMERCIAL", 47.6096, -122.3330),
    ("M3", "West", "M", "PIONEER SQUARE", 47.6010, -122.3320),
    ("U1", "North", "U", "UNIVERSITY DISTRICT", 47.6600, -122.3130),
    ("B2", "North", "B", "FREMONT", 47.6510, -122.3500),
    ("E2", "East", "E", "CAPITOL HILL", 47.6190, -122.3210),
    ("Q1", "North", "Q", "BALLARD", 47.6680, -122.3840),
]

# (crime_against_category, offense_parent_group, offense, nibrs_group)
OFFENSES = [
    ("PROPERTY", "LARCENY-THEFT", "THEFT", "A"),
    ("PROPERTY", "BURGLARY/BREAKING & ENTERING", "BURGLARY", "A"),
    ("PROPERTY", "MOTOR VEHICLE THEFT", "VEHICLE THEFT", "A"),
    ("PROPERTY", "DESTRUCTION/DAMAGE/VANDALISM", "VANDALISM", "A"),
    ("PERSON", "ASSAULT OFFENSES", "ASSAULT", "A"),
    ("SOCIETY", "DRUG/NARCOTIC OFFENSES", "DRUG POSSESSION", "B"),
]


def generate_rows() -> list[list[str]]:
    rng = random.Random(42)
    rows: list[list[str]] = []
    record_id = 1
    # Eight years of quarters (2018-Q1 .. 2025-Q4); a handful of incidents per beat per
    # quarter so every cluster has a multi-year, multi-category history.
    for quarter in range(32):
        year = 2018 + quarter // 4
        month = (quarter % 4) * 3 + 1
        for beat, precinct, sector, mcpp, lat, lon in CLUSTERS:
            for _ in range(rng.randint(1, 3)):
                category, parent_group, offense, nibrs = rng.choice(OFFENSES)
                start = datetime(
                    year, month, rng.randint(1, 28), rng.randint(0, 23), rng.randint(0, 59)
                )
                report = start + timedelta(hours=rng.randint(1, 12))
                jitter_lat = lat + rng.uniform(-0.0018, 0.0018)
                jitter_lon = lon + rng.uniform(-0.0018, 0.0018)
                rows.append([
                    f"{year}-{record_id:06d}",
                    f"SEED-{record_id:06d}",
                    start.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
                    "",
                    report.strftime("%Y-%m-%dT%H:%M:%S") + "Z",
                    category, parent_group, offense, nibrs,
                    precinct, sector, beat, mcpp,
                    f"{rng.choice([100, 200, 300, 400, 500])} BLOCK {mcpp}",
                    f"{jitter_lon:.6f}",
                    f"{jitter_lat:.6f}",
                ])
                record_id += 1
    return rows


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="app/data/seed_crime.csv")
    args = parser.parse_args()
    rows = generate_rows()
    with open(args.out, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(HEADER)
        writer.writerows(rows)
    print(f"wrote {len(rows)} seed incidents to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

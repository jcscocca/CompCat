from __future__ import annotations

import csv
import json
from datetime import date
from io import StringIO
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from app.models import utc_now
from app.parsers.base import parse_datetime
from app.schemas import CrimeIncidentData

CRIME_DATA_FLOOR = date(2018, 1, 1)


def floor_start_date(start_date: date | None) -> date:
    if start_date is None or start_date < CRIME_DATA_FLOOR:
        return CRIME_DATA_FLOOR
    return start_date


class SeattleSocrataClient:
    def __init__(self, base_url: str, dataset_id: str, app_token: str | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.dataset_id = dataset_id
        self.app_token = app_token

    def fetch_page(
        self,
        limit: int = 5000,
        offset: int = 0,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[CrimeIncidentData]:
        start_date = floor_start_date(start_date)
        query_params = {"$limit": limit, "$offset": offset}
        query_params["$order"] = "offense_date DESC"
        query_params["$where"] = _date_window_where(start_date, end_date)
        query = urlencode(query_params)
        request = Request(f"{self.base_url}/{self.dataset_id}.json?{query}")
        if self.app_token:
            request.add_header("X-App-Token", self.app_token)
        with urlopen(request, timeout=30) as response:
            rows = json.loads(response.read().decode("utf-8"))
        return [crime_incident_from_mapping(row) for row in rows]


def load_crime_csv(path: Path) -> list[CrimeIncidentData]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return [crime_incident_from_mapping(row) for row in reader]


def load_crime_csv_text(text: str) -> list[CrimeIncidentData]:
    reader = csv.DictReader(StringIO(text))
    return [crime_incident_from_mapping(row) for row in reader]


def crime_incident_from_mapping(row: dict[str, Any]) -> CrimeIncidentData:
    offense_id = _first(row, "offense_id", "offense")
    report_number = _first(row, "report_number", "report_num")
    latitude = _float_or_none(_first(row, "latitude", "lat", "y"))
    longitude = _float_or_none(_first(row, "longitude", "lon", "lng", "x"))
    return CrimeIncidentData(
        external_incident_id=offense_id or report_number,
        report_number=report_number,
        offense_id=offense_id,
        offense_start_utc=parse_datetime(
            _first(
                row,
                "offense_start_datetime",
                "offense_start_utc",
                "offense_start",
                "offense_date",
            )
        ),
        offense_end_utc=parse_datetime(
            _first(row, "offense_end_datetime", "offense_end_utc", "offense_end")
        ),
        report_utc=parse_datetime(_first(row, "report_datetime", "report_utc", "report_date_time")),
        offense_category=_first(
            row,
            "crime_against_category",
            "nibrs_crime_against_category",
            "offense_category",
        ),
        offense_subcategory=_first(
            row,
            "offense_parent_group",
            "offense_sub_category",
            "offense_subcategory",
            "offense",
        ),
        nibrs_group=_first(row, "nibrs_group", "nibrs_group_a_b"),
        precinct=_first(row, "precinct"),
        sector=_first(row, "sector"),
        beat=_first(row, "beat"),
        mcpp=_first(row, "mcpp", "neighborhood"),
        block_address=_first(row, "100_block_address", "block_address"),
        latitude=latitude,
        longitude=longitude,
        # SPD rows carry no snapshot_at, so stamp the ingest time — this is "ingested-at"
        # provenance (and powers last_ingested_at in the freshness endpoint), not a fixed
        # as-of date. (Previously hardcoded to 2024-01-01, which was wrong for every row.)
        snapshot_at=parse_datetime(_first(row, "snapshot_at")) or utc_now(),
    )


def _date_window_where(start_date: date | None, end_date: date | None) -> str:
    if start_date and end_date:
        return (
            f"offense_date between '{start_date.isoformat()}T00:00:00' "
            f"and '{end_date.isoformat()}T23:59:59'"
        )
    if start_date:
        return f"offense_date >= '{start_date.isoformat()}T00:00:00'"
    if end_date:
        return f"offense_date <= '{end_date.isoformat()}T23:59:59'"
    raise ValueError("At least one date is required.")


def _first(row: dict[str, Any], *keys: str) -> Any:
    lowered = {key.lower(): value for key, value in row.items()}
    for key in keys:
        value = lowered.get(key.lower())
        if value not in (None, ""):
            return value
    return None


def _float_or_none(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except ValueError:
        return None

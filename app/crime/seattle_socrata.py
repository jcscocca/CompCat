from __future__ import annotations

import csv
import json
from collections.abc import Callable
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
# The SPD Call Data set is ~24x the size of the reported-crime set (10.9M rows back to 2009),
# so it gets a much later floor — roughly a trailing 24 months from the project's current
# horizon. A fixed calendar floor (not a rolling window) mirrors CRIME_DATA_FLOOR and keeps
# ingest deterministic; lower it to date(2025, 7, 1) (12 months) if dev volume is too heavy.
CALLS_DATA_FLOOR = date(2024, 7, 1)


def floor_start_date(start_date: date | None, floor: date = CRIME_DATA_FLOOR) -> date:
    if start_date is None or start_date < floor:
        return floor
    return start_date


class SeattleSocrataClient:
    def __init__(
        self,
        base_url: str,
        dataset_id: str,
        app_token: str | None = None,
        *,
        mapper: Callable[[dict[str, Any]], CrimeIncidentData] | None = None,
        date_field: str = "offense_date",
        data_floor: date = CRIME_DATA_FLOOR,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.dataset_id = dataset_id
        self.app_token = app_token
        self.mapper = mapper or crime_incident_from_mapping
        self.date_field = date_field
        self.data_floor = data_floor

    def fetch_page(
        self,
        limit: int = 5000,
        offset: int = 0,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[CrimeIncidentData]:
        start_date = floor_start_date(start_date, self.data_floor)
        query_params = {"$limit": limit, "$offset": offset}
        query_params["$order"] = f"{self.date_field} DESC"
        query_params["$where"] = _date_window_where(start_date, end_date, self.date_field)
        query = urlencode(query_params)
        request = Request(f"{self.base_url}/{self.dataset_id}.json?{query}")
        if self.app_token:
            request.add_header("X-App-Token", self.app_token)
        with urlopen(request, timeout=30) as response:
            rows = json.loads(response.read().decode("utf-8"))
        return [self.mapper(row) for row in rows]


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


def arrest_from_mapping(row: dict[str, Any]) -> CrimeIncidentData:
    latitude = _float_or_none(_first(row, "latitude", "lat", "y"))
    longitude = _float_or_none(_first(row, "longitude", "lon", "lng", "x"))
    return CrimeIncidentData(
        external_incident_id=_first(row, "arrest_number"),
        report_number=_first(row, "report_number"),
        offense_id=None,
        offense_start_utc=parse_datetime(
            _first(row, "arrest_occurred_date_time", "arrest_occurred", "arrest_date")
        ),
        offense_end_utc=None,
        report_utc=parse_datetime(_first(row, "arrest_reported_date_time", "arrest_reported")),
        offense_category=None,
        # Best-effort taxonomy: NIBRS offense description goes in offense_subcategory. This
        # column therefore carries source-specific semantics (arrests vs SPD reports); safe
        # because reports-only default means arrests are never queried by category here, and
        # we never filter across sources. A unified crosswalk is a later increment.
        offense_subcategory=_first(row, "nibrs_description"),
        nibrs_group=None,
        precinct=_first(row, "precinct"),
        sector=_first(row, "sector"),
        beat=_first(row, "beat"),
        # The SPD Arrest export's canonical columns are `neighborhood` / `block_address`
        # (reports use `mcpp` / `100_block_address`), so those aliases come first here.
        mcpp=_first(row, "neighborhood", "mcpp"),
        block_address=_first(row, "block_address", "100_block_address"),
        latitude=latitude,
        longitude=longitude,
        source_dataset="seattle_spd_arrests",
        snapshot_at=parse_datetime(_first(row, "snapshot_at")) or utc_now(),
    )


def call_from_mapping(row: dict[str, Any]) -> CrimeIncidentData:
    # SPD Call Data (911 calls for service). Dispatch coordinates are redacted on sensitive
    # event types — they arrive as the literal string "REDACTED", which _float_or_none coerces
    # to None (those rows then fall out of the lat/long-gated bbox queries, exactly like a
    # reported incident with no geocode). The dataset emits one row per responding unit, so
    # multiple rows share a cad_event_number; using it as external_incident_id collapses them
    # to one stored row per call via the (source_dataset, external_incident_id) upsert.
    latitude = _float_or_none(_first(row, "dispatch_latitude", "latitude", "lat", "y"))
    longitude = _float_or_none(_first(row, "dispatch_longitude", "longitude", "lon", "lng", "x"))
    return CrimeIncidentData(
        external_incident_id=_first(row, "cad_event_number"),
        report_number=None,
        offense_id=None,
        offense_start_utc=parse_datetime(
            _first(row, "cad_event_original_time_queued", "original_time_queued")
        ),
        offense_end_utc=None,
        report_utc=parse_datetime(_first(row, "cad_event_arrived_time", "arrived_time")),
        offense_category=None,
        # Final call type carries the filterable dimension (e.g. "DISTURBANCE - OTHER"). As with
        # arrests, offense_subcategory holds source-specific semantics; category/nibrs stay null.
        offense_subcategory=_first(row, "final_call_type", "initial_call_type", "call_type"),
        nibrs_group=None,
        precinct=_first(row, "dispatch_precinct", "precinct"),
        sector=_first(row, "dispatch_sector", "sector"),
        beat=_first(row, "dispatch_beat", "beat"),
        mcpp=_first(row, "dispatch_neighborhood", "neighborhood", "mcpp"),
        block_address=_first(row, "dispatch_address", "block_address"),
        latitude=latitude,
        longitude=longitude,
        source_dataset="seattle_spd_911",
        snapshot_at=parse_datetime(_first(row, "snapshot_at")) or utc_now(),
    )


def load_arrest_csv(path: Path) -> list[CrimeIncidentData]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return [arrest_from_mapping(row) for row in reader]


def load_calls_csv(path: Path) -> list[CrimeIncidentData]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        return [call_from_mapping(row) for row in reader]


def _date_window_where(
    start_date: date | None, end_date: date | None, field: str = "offense_date"
) -> str:
    if start_date and end_date:
        return (
            f"{field} between '{start_date.isoformat()}T00:00:00' "
            f"and '{end_date.isoformat()}T23:59:59'"
        )
    if start_date:
        return f"{field} >= '{start_date.isoformat()}T00:00:00'"
    if end_date:
        return f"{field} <= '{end_date.isoformat()}T23:59:59'"
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

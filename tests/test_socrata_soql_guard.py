from __future__ import annotations

import pytest

from app.crime.seattle_socrata import (
    SeattleSocrataClient,
    _safe_soql_field,
    _safe_soql_timestamp,
)


def test_safe_soql_field_accepts_registry_columns():
    for field in ("offense_date", "arrest_occurred_date_time", "cad_event_original_time_queued"):
        assert _safe_soql_field(field) == field


@pytest.mark.parametrize("bad", ["offense_date; drop", "a' or '1'='1", "date field", "", "1col"])
def test_safe_soql_field_rejects_injection_shapes(bad):
    with pytest.raises(ValueError, match="Unsafe SoQL field name"):
        _safe_soql_field(bad)


def test_safe_soql_timestamp_accepts_iso_shapes():
    for value in ("2024-01-01", "2024-01-01T00:00:00", "2024-01-01T00:00:00.123"):
        assert _safe_soql_timestamp(value) == value


@pytest.mark.parametrize("bad", ["2024-01-01' or '1'='1", "not-a-date", "2024/01/01"])
def test_safe_soql_timestamp_rejects_injection_shapes(bad):
    with pytest.raises(ValueError, match="Unsafe SoQL timestamp literal"):
        _safe_soql_timestamp(bad)


def test_client_rejects_unsafe_date_field_at_construction():
    with pytest.raises(ValueError, match="Unsafe SoQL field name"):
        SeattleSocrataClient(
            base_url="https://data.seattle.gov/resource",
            dataset_id="tazs-3rd5",
            date_field="offense_date' --",
        )

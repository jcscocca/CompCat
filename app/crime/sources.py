from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.crime.seattle_socrata import (
    arrest_from_mapping,
    call_from_mapping,
    calls_data_floor,
    crime_data_floor,
    crime_incident_from_mapping,
)
from app.schemas import CrimeIncidentData

SOURCE_SPD_CRIME = "seattle_spd_crime"
SOURCE_SPD_ARRESTS = "seattle_spd_arrests"
SOURCE_SPD_911 = "seattle_spd_911"


@dataclass(frozen=True)
class CrimeSource:
    key: str
    dataset_attr: str  # Settings attribute holding this source's Socrata dataset id
    mapper: Callable[[dict[str, Any]], CrimeIncidentData]
    date_field: str  # Socrata column used for $order / $where windowing
    # Unique Socrata row identifier paired with date_field for keyset pagination. Domain IDs
    # are insufficient here: 911 has multiple responding-unit rows per CAD event number.
    cursor_id_field: str
    data_floor: Callable[[date | None], date]  # resolves the earliest ingest date for a run
    # When True the data_floor is a *rolling* window (not fixed history): ingest must also purge
    # stored rows that have fallen below the current floor, or the layer silently outgrows its
    # advertised window (fetch-side floors only bound new fetches). See purge_incidents_below_floor.
    rolling_window: bool = False


CRIME_SOURCES: dict[str, CrimeSource] = {
    SOURCE_SPD_CRIME: CrimeSource(
        key=SOURCE_SPD_CRIME,
        dataset_attr="socrata_dataset_id",
        mapper=crime_incident_from_mapping,
        date_field="offense_date",
        cursor_id_field=":id",
        data_floor=crime_data_floor,
    ),
    SOURCE_SPD_ARRESTS: CrimeSource(
        key=SOURCE_SPD_ARRESTS,
        dataset_attr="socrata_arrests_dataset_id",
        mapper=arrest_from_mapping,
        date_field="arrest_occurred_date_time",
        cursor_id_field=":id",
        data_floor=crime_data_floor,
    ),
    SOURCE_SPD_911: CrimeSource(
        key=SOURCE_SPD_911,
        dataset_attr="socrata_calls_dataset_id",
        mapper=call_from_mapping,
        date_field="cad_event_original_time_queued",
        cursor_id_field=":id",
        data_floor=calls_data_floor,
        rolling_window=True,
    ),
}


# Map analysis (UI) layers onto the underlying source datasets. The three layers are
# mutually exclusive: "reported" is SPD crime reports only; "arrests" is SPD arrest records
# (enforcement activity — an arrest is logged where the arrest was made, which may differ from
# where an offense occurred, and most reported crimes never result in one); "calls" is 911
# calls for service. Arrests are deliberately NOT unioned into "reported" — on the public
# (redacted) data an arrest can't be linked back to its crime, so unioning double-counts and
# conflates enforcement geography with incidence. See docs/architecture/data-model.md.
LAYER_REPORTED = "reported"
LAYER_ARRESTS = "arrests"
LAYER_CALLS = "calls"

LAYERS: dict[str, tuple[str, ...]] = {
    LAYER_REPORTED: (SOURCE_SPD_CRIME,),
    LAYER_ARRESTS: (SOURCE_SPD_ARRESTS,),
    LAYER_CALLS: (SOURCE_SPD_911,),
}


def get_crime_source(key: str) -> CrimeSource:
    try:
        return CRIME_SOURCES[key]
    except KeyError:
        raise ValueError(f"Unknown crime source: {key!r}") from None


def sources_for_layer(layer: str) -> tuple[str, ...]:
    try:
        return LAYERS[layer]
    except KeyError:
        raise ValueError(f"Unknown layer: {layer!r}") from None

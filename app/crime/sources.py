from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any

from app.crime.seattle_socrata import (
    CALLS_DATA_FLOOR,
    CRIME_DATA_FLOOR,
    arrest_from_mapping,
    call_from_mapping,
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
    data_floor: date  # earliest date this source is ingested from


CRIME_SOURCES: dict[str, CrimeSource] = {
    SOURCE_SPD_CRIME: CrimeSource(
        key=SOURCE_SPD_CRIME,
        dataset_attr="socrata_dataset_id",
        mapper=crime_incident_from_mapping,
        date_field="offense_date",
        data_floor=CRIME_DATA_FLOOR,
    ),
    SOURCE_SPD_ARRESTS: CrimeSource(
        key=SOURCE_SPD_ARRESTS,
        dataset_attr="socrata_arrests_dataset_id",
        mapper=arrest_from_mapping,
        date_field="arrest_occurred_date_time",
        data_floor=CRIME_DATA_FLOOR,
    ),
    SOURCE_SPD_911: CrimeSource(
        key=SOURCE_SPD_911,
        dataset_attr="socrata_calls_dataset_id",
        mapper=call_from_mapping,
        date_field="cad_event_original_time_queued",
        data_floor=CALLS_DATA_FLOOR,
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

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from app.crime.seattle_socrata import arrest_from_mapping, crime_incident_from_mapping
from app.schemas import CrimeIncidentData

SOURCE_SPD_CRIME = "seattle_spd_crime"
SOURCE_SPD_ARRESTS = "seattle_spd_arrests"


@dataclass(frozen=True)
class CrimeSource:
    key: str
    dataset_attr: str  # Settings attribute holding this source's Socrata dataset id
    mapper: Callable[[dict[str, Any]], CrimeIncidentData]
    date_field: str  # Socrata column used for $order / $where windowing


CRIME_SOURCES: dict[str, CrimeSource] = {
    SOURCE_SPD_CRIME: CrimeSource(
        key=SOURCE_SPD_CRIME,
        dataset_attr="socrata_dataset_id",
        mapper=crime_incident_from_mapping,
        date_field="offense_date",
    ),
    SOURCE_SPD_ARRESTS: CrimeSource(
        key=SOURCE_SPD_ARRESTS,
        dataset_attr="socrata_arrests_dataset_id",
        mapper=arrest_from_mapping,
        date_field="arrest_occurred_date_time",
    ),
}


def get_crime_source(key: str) -> CrimeSource:
    try:
        return CRIME_SOURCES[key]
    except KeyError:
        raise ValueError(f"Unknown crime source: {key!r}") from None

import pytest

from app.crime.seattle_socrata import arrest_from_mapping, crime_incident_from_mapping
from app.crime.sources import (
    SOURCE_SPD_ARRESTS,
    SOURCE_SPD_CRIME,
    get_crime_source,
)


def test_source_constants_match_stored_tags():
    assert SOURCE_SPD_CRIME == "seattle_spd_crime"
    assert SOURCE_SPD_ARRESTS == "seattle_spd_arrests"
    assert arrest_from_mapping({"arrest_number": "x"}).source_dataset == SOURCE_SPD_ARRESTS


def test_registry_resolves_known_sources():
    crime = get_crime_source(SOURCE_SPD_CRIME)
    assert crime.dataset_attr == "socrata_dataset_id"
    assert crime.mapper is crime_incident_from_mapping
    assert crime.date_field == "offense_date"

    arrests = get_crime_source(SOURCE_SPD_ARRESTS)
    assert arrests.dataset_attr == "socrata_arrests_dataset_id"
    assert arrests.mapper is arrest_from_mapping
    assert arrests.date_field == "arrest_occurred_date_time"


def test_registry_rejects_unknown_source():
    with pytest.raises(ValueError, match="Unknown crime source"):
        get_crime_source("nope")

from app.crime.seattle_socrata import arrest_from_mapping

_ROW = {
    "arrest_number": "19-001212",
    "arrest_occurred_date_time": "2019-05-21T00:00:00.000",
    "arrest_reported_date_time": "2019-05-21T10:40:34.000",
    "nibrs_description": "All Other Larceny",
    "offense_type": "SMC - 12A.08.060 | THEFT-OTH",
    "beat": "K1",
    "sector": "KING",
    "precinct": "West",
    "neighborhood": "DOWNTOWN COMMERCIAL",
    "block_address": "6XX BLOCK OF 5TH AVE",
    "report_number": "20170000288588",
    "latitude": "47.60405522",
    "longitude": "-122.32951432",
    "subject_race": "Black or African American",
    "subject_gender": "Male",
    "subject_age_range": "46 - 55",
    "officer_id": "1028",
    "officer_race": "Black or African American",
}

_DEMOGRAPHIC_FIELDS = (
    "subject_race",
    "subject_gender",
    "subject_age_range",
    "officer_id",
    "officer_race",
)


def test_arrest_row_maps_to_incident_fields():
    incident = arrest_from_mapping(_ROW)
    assert incident.external_incident_id == "19-001212"
    assert incident.source_dataset == "seattle_spd_arrests"
    assert incident.offense_start_utc is not None
    assert incident.offense_start_utc.isoformat() == "2019-05-21T00:00:00+00:00"
    assert incident.report_utc is not None
    assert incident.report_utc.isoformat() == "2019-05-21T10:40:34+00:00"
    assert incident.offense_subcategory == "All Other Larceny"
    assert incident.offense_category == "PROPERTY"
    assert incident.nibrs_group == "A"
    assert incident.beat == "K1"
    assert incident.sector == "KING"
    assert incident.precinct == "West"
    assert incident.mcpp == "DOWNTOWN COMMERCIAL"
    assert incident.block_address == "6XX BLOCK OF 5TH AVE"
    assert incident.report_number == "20170000288588"
    assert incident.latitude == 47.60405522
    assert incident.longitude == -122.32951432


def test_arrest_mapper_drops_demographics_by_construction():
    incident = arrest_from_mapping(_ROW)
    dumped = incident.model_dump()
    for forbidden in _DEMOGRAPHIC_FIELDS:
        assert forbidden not in dumped


def test_arrest_mapper_accepts_redacted_coordinates():
    incident = arrest_from_mapping({**_ROW, "latitude": "", "longitude": ""})
    assert incident.latitude is None
    assert incident.longitude is None
    assert incident.external_incident_id == "19-001212"

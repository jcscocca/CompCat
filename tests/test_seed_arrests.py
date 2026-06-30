from importlib import resources

from app.crime.seattle_socrata import load_arrest_csv


def test_packaged_arrest_seed_loads_and_is_tagged():
    incidents = load_arrest_csv(resources.files("app.data").joinpath("seed_arrests.csv"))
    assert len(incidents) >= 8
    assert all(i.source_dataset == "seattle_spd_arrests" for i in incidents)
    assert len({i.external_incident_id for i in incidents}) == len(incidents)  # unique
    assert all(i.offense_subcategory for i in incidents)  # nibrs_description present
    assert all(i.latitude is not None and i.longitude is not None for i in incidents)
    assert len({i.beat for i in incidents}) >= 3

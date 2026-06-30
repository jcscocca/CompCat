from importlib import resources

from app.crime.seattle_socrata import load_calls_csv


def test_packaged_calls_seed_loads_and_is_tagged():
    incidents = load_calls_csv(resources.files("app.data").joinpath("seed_calls.csv"))
    assert len(incidents) >= 8
    assert all(i.source_dataset == "seattle_spd_911" for i in incidents)
    assert len({i.external_incident_id for i in incidents}) == len(incidents)  # unique events
    assert all(i.offense_subcategory for i in incidents)  # final_call_type present
    # Calls carry no offense taxonomy — only the call type, in offense_subcategory.
    assert all(i.offense_category is None and i.nibrs_group is None for i in incidents)
    assert all(i.latitude is not None and i.longitude is not None for i in incidents)
    assert len({i.beat for i in incidents}) >= 3

from __future__ import annotations

from importlib import resources

from app.crime.seattle_socrata import load_crime_csv


def test_packaged_seed_dataset_is_substantial_and_varied():
    # Guards the deploy seed: a fresh deploy should render meaningful dashboards/baselines,
    # so the bundled seed must stay non-trivial and spread across beats, categories, years.
    incidents = load_crime_csv(resources.files("app.data").joinpath("seed_crime.csv"))
    assert len(incidents) >= 200
    assert len({i.external_incident_id for i in incidents}) == len(incidents)  # unique ids
    assert len({i.beat for i in incidents}) >= 5
    assert len({i.offense_category for i in incidents}) >= 3
    assert all(i.latitude is not None and i.longitude is not None for i in incidents)
    years = {i.offense_start_utc.year for i in incidents if i.offense_start_utc}
    assert max(years) - min(years) >= 3  # multi-year span

from __future__ import annotations

import json

import pytest

from app.analysis.area_baselines import (
    load_mcpp_areas,
    load_mcpp_polygons,
    normalize_mcpp,
    sector_for_beat,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("BALLARD NORTH", "BALLARD NORTH"),
        ("  ballard north ", "BALLARD NORTH"),
        ("UNKNOWN", None),
        ("OOJ", None),
        ("NULL", None),
        ("-", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_mcpp(raw, expected):
    assert normalize_mcpp(raw) == expected


@pytest.mark.parametrize(
    ("beat", "expected"),
    [
        ("M3", "M"),
        ("b1", "B"),
        (" C2 ", "C"),
        ("99", None),   # harbor placeholder beat — not a lettered sector
        ("OOJ", None),
        ("-", None),
        (None, None),
        ("", None),
    ],
)
def test_sector_for_beat(beat, expected):
    assert sector_for_beat(beat) == expected


def test_load_mcpp_areas_and_polygons_from_files(tmp_path):
    csv_path = tmp_path / "areas.csv"
    csv_path.write_text("mcpp,area_km2\nTEST HILL,3.0\n", encoding="utf-8")
    geo_path = tmp_path / "areas.geojson"
    geo_path.write_text(
        json.dumps(
            {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "properties": {"mcpp": "TEST HILL"},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
                        },
                    },
                    {  # junk-named features are skipped
                        "type": "Feature",
                        "properties": {"mcpp": "UNKNOWN"},
                        "geometry": {
                            "type": "Polygon",
                            "coordinates": [[[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]]],
                        },
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    assert load_mcpp_areas(csv_path) == {"TEST HILL": 3.0}
    polygons = load_mcpp_polygons(geo_path)
    assert set(polygons) == {"TEST HILL"}


def test_load_mcpp_areas_rejects_non_positive_area(tmp_path):
    csv_path = tmp_path / "areas.csv"
    csv_path.write_text("mcpp,area_km2\nTEST HILL,0\n", encoding="utf-8")
    with pytest.raises(ValueError):
        load_mcpp_areas(csv_path)

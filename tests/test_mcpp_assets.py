from __future__ import annotations

import json

from app.analysis.area_baselines import (
    DEFAULT_MCPP_GEOJSON,
    load_mcpp_areas,
    load_mcpp_polygons,
)


def test_bundled_mcpp_assets_are_consistent() -> None:
    areas = load_mcpp_areas()
    polygons = load_mcpp_polygons()
    # Every polygon has an area row and vice versa; the layer has ~60 neighborhoods.
    assert set(areas) == set(polygons)
    assert len(areas) >= 55
    # Known-value canary from the published layer.
    assert "BALLARD NORTH" in areas
    # Names are normalized UPPERCASE (matching the SODA `mcpp` column's style).
    assert all(name == name.strip().upper() for name in areas)


def test_bundled_mcpp_geojson_is_slim() -> None:
    body = json.loads(DEFAULT_MCPP_GEOJSON.read_text(encoding="utf-8"))
    for feature in body["features"]:
        assert set(feature["properties"].keys()) == {"mcpp"}

"""Point-in-polygon beat assignment and the shipped beat-polygon asset."""
from __future__ import annotations

from app.analysis.beat_baselines import (
    NON_GEOGRAPHIC_BEATS,
    assign_beat,
    load_beat_areas,
    load_beat_polygons,
)


def test_loaded_polygon_beats_match_the_area_csv_beats():
    # Every beat with a shipped area must have a polygon, and vice versa — otherwise a
    # place could resolve to a beat with no area (or carry an area no place can reach).
    polygons = load_beat_polygons()
    areas = load_beat_areas()
    assert set(polygons) == set(areas)
    assert not (set(polygons) & NON_GEOGRAPHIC_BEATS)


def test_downtown_point_resolves_to_its_real_beat():
    polygons = load_beat_polygons()
    # A downtown Seattle point well inside beat M3 in the published 2018-present layer.
    assert assign_beat(-122.33595, 47.60945, polygons) == "M3"


def test_point_outside_all_beats_returns_none():
    polygons = load_beat_polygons()
    # Well outside Seattle (eastern Washington) — inside no beat polygon.
    assert assign_beat(-118.0, 47.0, polygons) is None


def test_assign_beat_respects_polygon_holes():
    # A doughnut: outer 10x10 square with a 2x2 hole at the centre.
    outer = [(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0), (-5.0, -5.0)]
    hole = [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0), (-1.0, -1.0)]
    polygons = {"DONUT": [[outer, hole]]}
    # Inside the ring but outside the hole -> assigned.
    assert assign_beat(3.0, 0.0, polygons) == "DONUT"
    # Inside the hole -> not assigned.
    assert assign_beat(0.0, 0.0, polygons) is None


def test_assign_beat_handles_multipolygon():
    west = [(-10.0, 0.0), (-8.0, 0.0), (-8.0, 2.0), (-10.0, 2.0), (-10.0, 0.0)]
    east = [(8.0, 0.0), (10.0, 0.0), (10.0, 2.0), (8.0, 2.0), (8.0, 0.0)]
    polygons = {"SPLIT": [[west], [east]]}
    assert assign_beat(-9.0, 1.0, polygons) == "SPLIT"
    assert assign_beat(9.0, 1.0, polygons) == "SPLIT"
    assert assign_beat(0.0, 1.0, polygons) is None

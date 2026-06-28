from __future__ import annotations

import csv
import json
from collections.abc import Iterable
from dataclasses import dataclass
from math import isfinite
from pathlib import Path

from app.analysis.rate_tests import (
    ALPHA,
    MAX_RATE_RATIO_FOR_RECOMMENDATION,
    MIN_ANALYSIS_DAYS,
    MIN_COMBINED_COUNT,
    MIN_PLACE_COUNT,
    compare_incident_rates,
    dispersion_status,
)

DEFAULT_AREA_CSV = (
    Path(__file__).resolve().parent.parent / "data" / "seattle_police_beats_2018_area.csv"
)
DEFAULT_BEATS_GEOJSON = (
    Path(__file__).resolve().parent.parent / "data" / "seattle_police_beats_2018.geojson"
)

# A beat polygon set: beat code -> list of polygons; each polygon is a list of linear
# rings (ring 0 is the exterior, any others are holes); each ring is a list of
# ``(longitude, latitude)`` vertices. Normalised from GeoJSON Polygon/MultiPolygon.
BeatPolygons = dict[str, list[list[list[tuple[float, float]]]]]

# Placeholder ``beat`` codes that SPD records on incidents but that are not real police
# beats and therefore have no polygon in the published "Seattle Police Beats 2018-Present"
# layer. ``-`` marks an untagged/unknown beat; ``OOJ`` marks "out of jurisdiction" (the
# incident is outside Seattle). These can never be covered by the area lookup, so the
# coverage check skips them rather than reporting them as missing geometry.
NON_GEOGRAPHIC_BEATS: frozenset[str] = frozenset({"-", "OOJ"})


def load_beat_areas(path: Path | None = None) -> dict[str, float]:
    source = path or DEFAULT_AREA_CSV
    areas: dict[str, float] = {}
    with Path(source).open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            beat = (row.get("beat") or "").strip()
            if not beat:
                continue
            area = float(row["area_km2"])
            if not isfinite(area) or area <= 0:
                raise ValueError(f"Beat {beat} has non-positive area {area}.")
            areas[beat] = area
    return areas


def load_beat_polygons(path: Path | None = None) -> BeatPolygons:
    """Load the WGS84 beat polygons used for point-in-polygon beat assignment.

    Normalises GeoJSON ``Polygon`` and ``MultiPolygon`` features into the
    ``BeatPolygons`` shape and skips the non-geographic placeholder beats (which
    have no geometry). Coordinates stay ``(lon, lat)`` to match GeoJSON order.
    """
    source = path or DEFAULT_BEATS_GEOJSON
    with Path(source).open(encoding="utf-8") as handle:
        data = json.load(handle)

    polygons: BeatPolygons = {}
    for feature in data.get("features", []):
        beat = (feature.get("properties", {}).get("beat") or "").strip()
        geometry = feature.get("geometry") or {}
        geom_type = geometry.get("type")
        if not beat or beat in NON_GEOGRAPHIC_BEATS:
            continue
        if geom_type == "Polygon":
            multi = [geometry["coordinates"]]
        elif geom_type == "MultiPolygon":
            multi = geometry["coordinates"]
        else:
            continue
        rings = [
            [[(float(x), float(y)) for x, y in ring] for ring in poly] for poly in multi
        ]
        polygons.setdefault(beat, []).extend(rings)
    return polygons


def _point_in_ring(lon: float, lat: float, ring: list[tuple[float, float]]) -> bool:
    """Even-odd ray-casting (PNPOLY). The ``(yi > lat) != (yj > lat)`` guard ensures the
    edge straddles the test latitude before the division, so ``yj - yi`` is never zero."""
    inside = False
    count = len(ring)
    j = count - 1
    for i in range(count):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if ((yi > lat) != (yj > lat)) and (
            lon < (xj - xi) * (lat - yi) / (yj - yi) + xi
        ):
            inside = not inside
        j = i
    return inside


def _point_in_polygon(lon: float, lat: float, rings: list[list[tuple[float, float]]]) -> bool:
    # Inside the exterior ring (rings[0]) and outside every hole (rings[1:]).
    if not rings or not _point_in_ring(lon, lat, rings[0]):
        return False
    return not any(_point_in_ring(lon, lat, hole) for hole in rings[1:])


def assign_beat(lon: float, lat: float, beat_polygons: BeatPolygons) -> str | None:
    """Return the beat whose polygon contains ``(lon, lat)``, or ``None`` when the point
    falls outside every beat (water, a coverage gap, or outside Seattle)."""
    for beat, polygons in beat_polygons.items():
        if any(_point_in_polygon(lon, lat, rings) for rings in polygons):
            return beat
    return None


def missing_beat_areas(
    incident_beats: Iterable[str | None], area_lookup: dict[str, float]
) -> set[str]:
    return {
        beat
        for beat in incident_beats
        if beat and beat not in NON_GEOGRAPHIC_BEATS and beat not in area_lookup
    }


# ---------------------------------------------------------------------------
# Place-vs-beat statistics
# ---------------------------------------------------------------------------

HIGH_RATE_RATIO = 1.0 / MAX_RATE_RATIO_FOR_RECOMMENDATION  # 1.25


def neighborhood_decision(
    *, rate_ratio: float, adjusted_p_value: float, minimum_data_met: bool, model_warning: bool
) -> str:
    if not minimum_data_met:
        return "insufficient_data"
    if model_warning:
        return "model_warning"
    if adjusted_p_value < ALPHA and rate_ratio >= HIGH_RATE_RATIO:
        return "above_clear"
    if adjusted_p_value < ALPHA and rate_ratio <= MAX_RATE_RATIO_FOR_RECOMMENDATION:
        return "below_clear"
    return "not_clear"


@dataclass(frozen=True)
class PlaceVsBeat:
    place_rate: float
    beat_rate: float
    rate_ratio: float
    ci_lower: float
    ci_upper: float
    p_value: float
    adjusted_p_value: float
    method: str
    overdispersion_status: str
    minimum_data_status: str
    decision: str
    exact_p_value: float | None = None


def _minimum_data_status(
    *, analysis_days: int, place_count: int, beat_count: int,
    place_exposure: float, beat_exposure: float,
) -> str:
    if analysis_days < MIN_ANALYSIS_DAYS:
        return "date_range_too_short"
    if place_exposure <= 0 or beat_exposure <= 0:
        return "non_positive_exposure"
    if place_count < MIN_PLACE_COUNT:
        return "place_count_too_low"
    if place_count + beat_count < MIN_COMBINED_COUNT:
        return "combined_count_too_low"
    return "met"


def place_vs_beat(
    *,
    place_count: int,
    place_exposure: float,
    beat_count: int,
    beat_exposure: float,
    combined_monthly_counts: list[int],
    analysis_days: int,
    adjusted_p_value: float | None = None,
) -> PlaceVsBeat:
    status = _minimum_data_status(
        analysis_days=analysis_days,
        place_count=place_count,
        beat_count=beat_count,
        place_exposure=place_exposure,
        beat_exposure=beat_exposure,
    )
    dispersion = dispersion_status(combined_monthly_counts)
    test = compare_incident_rates(
        count_a=place_count,
        exposure_a=max(place_exposure, 1e-9),
        count_b=beat_count,
        exposure_b=max(beat_exposure, 1e-9),
        overdispersion_phi=dispersion.phi,
    )
    p_adjusted = test.p_value if adjusted_p_value is None else adjusted_p_value
    decision = neighborhood_decision(
        rate_ratio=test.rate_ratio,
        adjusted_p_value=p_adjusted,
        minimum_data_met=status == "met",
        model_warning=dispersion.status == "insufficient_periods",
    )
    return PlaceVsBeat(
        place_rate=test.rate_a,
        beat_rate=test.rate_b,
        rate_ratio=test.rate_ratio,
        ci_lower=test.ci_lower,
        ci_upper=test.ci_upper,
        p_value=test.p_value,
        adjusted_p_value=p_adjusted,
        method=test.method,
        overdispersion_status=test.overdispersion_status,
        minimum_data_status=status,
        decision=decision,
        exact_p_value=test.exact_p_value,
    )

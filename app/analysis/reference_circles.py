"""Empirical equal-radius reference-circle comparisons.

Incidents stay at their observed coordinates. MCPP/sector polygons choose the population of
eligible street-segment centers; each chosen center receives the same radius, date window, and
incident filters as the selected place. The output is descriptive (quantiles and
fewer/equal/more shares), never a p-value or risk estimate.
"""
from __future__ import annotations

import csv
import hashlib
import json
import random
from collections import defaultdict
from dataclasses import dataclass
from functools import lru_cache
from math import cos, floor, pi, radians, sqrt
from pathlib import Path
from typing import Any, Literal

from app.analysis.area_baselines import mcpp_display_label, sector_for_beat
from app.analysis.beat_baselines import BeatPolygons, _point_in_polygon
from app.normalization.geo import haversine_m

DEFAULT_REFERENCE_CENTERS = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "seattle_street_segment_midpoints_v1.csv"
)
DEFAULT_REFERENCE_METADATA = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "seattle_street_segment_midpoints_v1.json"
)

SAMPLING_FRAME = "street_segment_midpoints"
MIN_REFERENCE_CENTERS = 100
MIN_POLYGON_COVERAGE = 0.80
MAX_EXACT_MEMBERSHIPS = 2_500
MONTE_CARLO_DRAWS = 2_500
_GRID_DEGREES = 0.002
_OVERLAP_SAMPLES_PER_AXIS = 41

ReferenceKind = Literal["mcpp", "sector", "city"]


@dataclass(frozen=True)
class ReferenceCenter:
    center_id: str
    latitude: float
    longitude: float
    street_name: str
    mcpps: tuple[str, ...]
    sector: str | None


@dataclass(frozen=True)
class ReferenceFrame:
    version: str
    centers: tuple[ReferenceCenter, ...]
    by_mcpp: dict[str, tuple[int, ...]]
    by_sector: dict[str, tuple[int, ...]]
    metadata: dict[str, Any]


@dataclass(frozen=True)
class ReferenceComponent:
    component_id: str
    label: str
    weight: float
    center_indices: tuple[int, ...]


class IncidentGrid:
    """Small dependency-free spatial index; haversine remains the final membership test."""

    def __init__(self, coordinates: list[tuple[float, float]]) -> None:
        buckets: dict[tuple[int, int], list[tuple[float, float]]] = defaultdict(list)
        for lat, lon in coordinates:
            buckets[self._key(lat, lon)].append((lat, lon))
        self._buckets = dict(buckets)

    @staticmethod
    def _key(lat: float, lon: float) -> tuple[int, int]:
        return floor(lat / _GRID_DEGREES), floor(lon / _GRID_DEGREES)

    def count_within(self, latitude: float, longitude: float, radius_m: int) -> int:
        lat_pad = radius_m / 111_320.0
        lon_pad = radius_m / max(111_320.0 * cos(radians(latitude)), 1.0)
        min_row, min_col = self._key(latitude - lat_pad, longitude - lon_pad)
        max_row, max_col = self._key(latitude + lat_pad, longitude + lon_pad)
        count = 0
        for row in range(min_row, max_row + 1):
            for col in range(min_col, max_col + 1):
                for incident_lat, incident_lon in self._buckets.get((row, col), ()):
                    if (
                        haversine_m(
                            latitude,
                            longitude,
                            incident_lat,
                            incident_lon,
                        )
                        <= radius_m
                    ):
                        count += 1
        return count


def _asset_sha256(path: Path) -> str:
    # Git for Windows may check a text CSV out with CRLF even though the committed asset
    # and its version metadata use LF. CSV parsing treats the two forms identically, so hash
    # canonical LF bytes and keep the integrity check independent of the deployment host.
    canonical_bytes = path.read_bytes().replace(b"\r\n", b"\n")
    return hashlib.sha256(canonical_bytes).hexdigest()


@lru_cache(maxsize=4)
def load_reference_frame(
    centers_path: Path | None = None,
    metadata_path: Path | None = None,
) -> ReferenceFrame:
    centers_source = Path(centers_path or DEFAULT_REFERENCE_CENTERS)
    metadata_source = Path(metadata_path or DEFAULT_REFERENCE_METADATA)
    metadata = json.loads(metadata_source.read_text(encoding="utf-8"))
    expected_hash = metadata.get("sha256")
    if expected_hash and _asset_sha256(centers_source) != expected_hash:
        raise ValueError("reference-center asset does not match its version metadata")

    centers: list[ReferenceCenter] = []
    by_mcpp: dict[str, list[int]] = defaultdict(list)
    by_sector: dict[str, list[int]] = defaultdict(list)
    with centers_source.open(newline="", encoding="utf-8-sig") as handle:
        for row in csv.DictReader(handle):
            center = ReferenceCenter(
                center_id=row["center_id"],
                latitude=float(row["latitude"]),
                longitude=float(row["longitude"]),
                street_name=row.get("street_name") or "",
                mcpps=tuple(value for value in (row.get("mcpps") or "").split("|") if value),
                sector=(row.get("sector") or None),
            )
            index = len(centers)
            centers.append(center)
            for mcpp in center.mcpps:
                by_mcpp[mcpp].append(index)
            if center.sector:
                by_sector[center.sector].append(index)

    expected_count = metadata.get("center_count")
    if expected_count is not None and len(centers) != int(expected_count):
        raise ValueError("reference-center asset count does not match its version metadata")
    if not centers:
        raise ValueError("reference-center frame is empty")

    return ReferenceFrame(
        version=str(metadata["frame_version"]),
        centers=tuple(centers),
        by_mcpp={name: tuple(indices) for name, indices in by_mcpp.items()},
        by_sector={name: tuple(indices) for name, indices in by_sector.items()},
        metadata=metadata,
    )


def weighted_quantile(values: list[tuple[int, float]], quantile: float) -> int:
    if not values:
        raise ValueError("weighted quantile requires at least one value")
    if not 0 <= quantile <= 1:
        raise ValueError("quantile must be between zero and one")
    ordered = sorted(values, key=lambda item: item[0])
    total_weight = sum(weight for _, weight in ordered)
    if total_weight <= 0:
        raise ValueError("weighted quantile requires positive weight")
    threshold = quantile * total_weight
    cumulative = 0.0
    for value, weight in ordered:
        cumulative += weight
        if cumulative + 1e-12 >= threshold:
            return value
    return ordered[-1][0]


def summarize_reference_counts(
    weighted_counts: list[tuple[int, float]],
    *,
    target_count: int,
) -> dict[str, int | float]:
    total_weight = sum(weight for _, weight in weighted_counts)
    if total_weight <= 0:
        raise ValueError("reference counts require positive total weight")
    below = sum(weight for count, weight in weighted_counts if count < target_count)
    equal = sum(weight for count, weight in weighted_counts if count == target_count)
    above = sum(weight for count, weight in weighted_counts if count > target_count)
    return {
        "p10": weighted_quantile(weighted_counts, 0.10),
        "p25": weighted_quantile(weighted_counts, 0.25),
        "median": weighted_quantile(weighted_counts, 0.50),
        "p75": weighted_quantile(weighted_counts, 0.75),
        "p90": weighted_quantile(weighted_counts, 0.90),
        "share_below": below / total_weight,
        "share_equal": equal / total_weight,
        "share_above": above / total_weight,
        "midrank_percentile": (below + 0.5 * equal) / total_weight,
    }


def _component_weights(overlaps: dict[str, float]) -> dict[str, float]:
    positive = {name: area for name, area in overlaps.items() if area > 0}
    total = sum(positive.values())
    return {name: area / total for name, area in positive.items()} if total > 0 else {}


def polygon_overlap_profile(
    *,
    longitude: float,
    latitude: float,
    radius_m: int,
    polygons: BeatPolygons,
    samples_per_axis: int = _OVERLAP_SAMPLES_PER_AXIS,
) -> tuple[dict[str, float], float]:
    """Return per-polygon membership area and union coverage for one circle.

    MCPPs may overlap, so the component areas intentionally count every membership while
    ``covered_area_share`` counts an in-circle sample only once if any polygon contains it.
    Both use the same deterministic grid.
    """
    meters_per_lat = 111_320.0
    meters_per_lon = max(111_320.0 * cos(radians(latitude)), 1.0)
    dlat = radius_m / meters_per_lat
    dlon = radius_m / meters_per_lon
    min_lon, max_lon = longitude - dlon, longitude + dlon
    min_lat, max_lat = latitude - dlat, latitude + dlat
    candidates: dict[str, list[list[list[tuple[float, float]]]]] = {}
    for name, multipolygon in polygons.items():
        exterior = [point for rings in multipolygon for point in rings[0]]
        if not exterior:
            continue
        lons = [point[0] for point in exterior]
        lats = [point[1] for point in exterior]
        if min(lons) > max_lon or max(lons) < min_lon:
            continue
        if min(lats) > max_lat or max(lats) < min_lat:
            continue
        candidates[name] = multipolygon

    if samples_per_axis < 2:
        return {}, 0.0
    step = (2 * radius_m) / (samples_per_axis - 1)
    radius_sq = radius_m * radius_m
    in_circle = 0
    covered = 0
    memberships: dict[str, int] = defaultdict(int)
    for row in range(samples_per_axis):
        dy = -radius_m + row * step
        for col in range(samples_per_axis):
            dx = -radius_m + col * step
            if dx * dx + dy * dy > radius_sq:
                continue
            in_circle += 1
            sample_lon = longitude + dx / meters_per_lon
            sample_lat = latitude + dy / meters_per_lat
            names = [
                name
                for name, multipolygon in candidates.items()
                if any(
                    _point_in_polygon(sample_lon, sample_lat, rings)
                    for rings in multipolygon
                )
            ]
            if names:
                covered += 1
                for name in names:
                    memberships[name] += 1
    if in_circle == 0:
        return {}, 0.0
    circle_area_km2 = pi * radius_m * radius_m / 1_000_000.0
    return (
        {
            name: circle_area_km2 * count / in_circle
            for name, count in memberships.items()
        },
        covered / in_circle,
    )


def _effective_geographies(weights: list[float]) -> float:
    denominator = sum(weight * weight for weight in weights)
    return 1.0 / denominator if denominator > 0 else 0.0


def _seed(frame: ReferenceFrame, kind: ReferenceKind, lat: float, lon: float, radius_m: int) -> int:
    # Filters and dates are deliberately absent: changing the incident subset must not
    # silently change which comparison locations were sampled.
    material = f"{frame.version}|{kind}|{lat:.6f}|{lon:.6f}|{radius_m}"
    return int.from_bytes(hashlib.sha256(material.encode("utf-8")).digest()[:8], "big")


def _draw_allocations(
    components: list[ReferenceComponent], draw_count: int
) -> list[tuple[ReferenceComponent, int]]:
    raw = [(component, component.weight * draw_count) for component in components]
    allocations = {component.component_id: floor(value) for component, value in raw}
    remaining = draw_count - sum(allocations.values())
    ranked = sorted(
        raw,
        key=lambda item: (-(item[1] - floor(item[1])), item[0].component_id),
    )
    for component, _ in ranked[:remaining]:
        allocations[component.component_id] += 1
    return [(component, allocations[component.component_id]) for component in components]


def _weighted_center_indices(
    components: list[ReferenceComponent],
    *,
    frame: ReferenceFrame,
    kind: ReferenceKind,
    latitude: float,
    longitude: float,
    radius_m: int,
) -> tuple[list[tuple[int, float]], str, float | None]:
    membership_count = sum(len(component.center_indices) for component in components)
    if membership_count <= MAX_EXACT_MEMBERSHIPS:
        values = [
            (index, component.weight / len(component.center_indices))
            for component in components
            for index in component.center_indices
        ]
        return values, "exact", None

    rng = random.Random(_seed(frame, kind, latitude, longitude, radius_m))
    draws: list[tuple[int, float]] = []
    for component, allocation in _draw_allocations(components, MONTE_CARLO_DRAWS):
        draws.extend(
            (component.center_indices[rng.randrange(len(component.center_indices))], 1.0)
            for _ in range(allocation)
        )
    weight = 1.0 / len(draws)
    return (
        [(index, weight) for index, _ in draws],
        "monte_carlo",
        0.98 / sqrt(len(draws)),  # worst-case 95% margin for a binomial share
    )


def _unavailable_result(
    *,
    kind: ReferenceKind,
    label: str,
    frame: ReferenceFrame,
    target_count: int,
    status: str,
    covered_area_share: float,
    component_rows: list[dict[str, Any]],
    center_count: int,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "kind": kind,
        "label": label,
        "available": False,
        "adequacy_status": status,
        "sampling_frame": SAMPLING_FRAME,
        "sampling_frame_version": frame.version,
        "computation": None,
        "geography_components": component_rows,
        "reference_center_count": center_count,
        "reference_draw_count": 0,
        "monte_carlo_error": None,
        "covered_area_share": covered_area_share,
        "effective_geographies": _effective_geographies(
            [row["weight"] for row in component_rows]
        ),
        "target_count": target_count,
        "p10": None,
        "p25": None,
        "median": None,
        "p75": None,
        "p90": None,
        "share_below": None,
        "share_equal": None,
        "share_above": None,
        "midrank_percentile": None,
        "warnings": warnings or [],
    }


def build_reference_distribution(
    *,
    kind: ReferenceKind,
    label: str,
    frame: ReferenceFrame,
    components: list[ReferenceComponent],
    incident_grid: IncidentGrid,
    target_count: int,
    latitude: float,
    longitude: float,
    radius_m: int,
    covered_area_share: float,
) -> dict[str, Any]:
    warnings: list[str] = []
    supported = [component for component in components if component.center_indices]
    if supported and len(supported) < len(components):
        # Boundary rasterization can pick up a sliver of a geography with no eligible
        # street centers (for example Seattle's water/harbor sector). Preserve that lost
        # membership as reduced coverage, then renormalize only the representable mixture.
        # A substantial unsupported share still fails the ordinary 80% coverage floor.
        supported_weight = sum(component.weight for component in supported)
        covered_area_share *= supported_weight
        components = [
            ReferenceComponent(
                component_id=component.component_id,
                label=component.label,
                weight=component.weight / supported_weight,
                center_indices=component.center_indices,
            )
            for component in supported
        ]
        warnings.append("partial_reference_frame_coverage")
    component_rows = [
        {
            "id": component.component_id,
            "label": component.label,
            "weight": component.weight,
            "center_count": len(component.center_indices),
        }
        for component in components
    ]
    unique_indices = {index for component in components for index in component.center_indices}
    center_count = len(unique_indices)
    if not components:
        return _unavailable_result(
            kind=kind,
            label=label,
            frame=frame,
            target_count=target_count,
            status="no_reference_geography",
            covered_area_share=covered_area_share,
            component_rows=[],
            center_count=0,
            warnings=warnings,
        )
    if any(not component.center_indices for component in components):
        return _unavailable_result(
            kind=kind,
            label=label,
            frame=frame,
            target_count=target_count,
            status="missing_reference_centers",
            covered_area_share=covered_area_share,
            component_rows=component_rows,
            center_count=center_count,
            warnings=warnings,
        )
    if center_count < MIN_REFERENCE_CENTERS:
        return _unavailable_result(
            kind=kind,
            label=label,
            frame=frame,
            target_count=target_count,
            status="insufficient_reference_centers",
            covered_area_share=covered_area_share,
            component_rows=component_rows,
            center_count=center_count,
            warnings=warnings,
        )
    if kind != "city" and covered_area_share < MIN_POLYGON_COVERAGE:
        return _unavailable_result(
            kind=kind,
            label=label,
            frame=frame,
            target_count=target_count,
            status="insufficient_polygon_coverage",
            covered_area_share=covered_area_share,
            component_rows=component_rows,
            center_count=center_count,
            warnings=warnings,
        )

    weighted_indices, computation, monte_carlo_error = _weighted_center_indices(
        components,
        frame=frame,
        kind=kind,
        latitude=latitude,
        longitude=longitude,
        radius_m=radius_m,
    )
    count_cache: dict[int, int] = {}
    weighted_counts: list[tuple[int, float]] = []
    for index, weight in weighted_indices:
        if index not in count_cache:
            center = frame.centers[index]
            count_cache[index] = incident_grid.count_within(
                center.latitude, center.longitude, radius_m
            )
        weighted_counts.append((count_cache[index], weight))

    summary = summarize_reference_counts(weighted_counts, target_count=target_count)
    if summary["p10"] == summary["p90"]:
        warnings.append("low_reference_contrast")
    if len(components) > 1:
        warnings.append("multi_geography_context")
    if covered_area_share < 0.999:
        warnings.append("partial_polygon_coverage")
    return {
        "kind": kind,
        "label": label,
        "available": True,
        "adequacy_status": "met",
        "sampling_frame": SAMPLING_FRAME,
        "sampling_frame_version": frame.version,
        "computation": computation,
        "geography_components": component_rows,
        "reference_center_count": center_count,
        "reference_draw_count": len(weighted_counts),
        "monte_carlo_error": monte_carlo_error,
        "covered_area_share": covered_area_share,
        "effective_geographies": _effective_geographies(
            [component.weight for component in components]
        ),
        "target_count": target_count,
        **summary,
        "warnings": warnings,
    }


def _mcpp_components(
    frame: ReferenceFrame,
    overlaps: dict[str, float],
) -> list[ReferenceComponent]:
    return [
        ReferenceComponent(
            component_id=name,
            label=mcpp_display_label(name),
            weight=weight,
            center_indices=frame.by_mcpp.get(name, ()),
        )
        for name, weight in sorted(_component_weights(overlaps).items())
    ]


def _sector_components(
    frame: ReferenceFrame,
    beat_overlaps: dict[str, float],
) -> list[ReferenceComponent]:
    sector_areas: dict[str, float] = defaultdict(float)
    for beat, area in beat_overlaps.items():
        sector = sector_for_beat(beat)
        if sector:
            sector_areas[sector] += area
    return [
        ReferenceComponent(
            component_id=sector,
            label=f"Sector {sector}",
            weight=weight,
            center_indices=frame.by_sector.get(sector, ()),
        )
        for sector, weight in sorted(_component_weights(dict(sector_areas)).items())
    ]


def reference_distributions_for_place(
    *,
    frame: ReferenceFrame,
    incident_grid: IncidentGrid,
    latitude: float,
    longitude: float,
    radius_m: int,
    target_count: int,
    mcpp_polygons: BeatPolygons | None,
    beat_polygons: BeatPolygons,
) -> list[dict[str, Any]]:
    mcpp_overlaps, mcpp_coverage = (
        polygon_overlap_profile(
            longitude=longitude,
            latitude=latitude,
            radius_m=radius_m,
            polygons=mcpp_polygons,
        )
        if mcpp_polygons
        else ({}, 0.0)
    )
    beat_overlaps, sector_coverage = polygon_overlap_profile(
        longitude=longitude,
        latitude=latitude,
        radius_m=radius_m,
        polygons=beat_polygons,
    )
    mcpp_components = _mcpp_components(frame, mcpp_overlaps)
    sector_components = _sector_components(frame, beat_overlaps)
    city_components = [
        ReferenceComponent(
            component_id="SEATTLE",
            label="Seattle",
            weight=1.0,
            center_indices=tuple(range(len(frame.centers))),
        )
    ]
    return [
        build_reference_distribution(
            kind="mcpp",
            label=(
                f"{mcpp_components[0].label} MCPP"
                if len(mcpp_components) == 1
                else "MCPP context"
            ),
            frame=frame,
            components=mcpp_components,
            incident_grid=incident_grid,
            target_count=target_count,
            latitude=latitude,
            longitude=longitude,
            radius_m=radius_m,
            covered_area_share=mcpp_coverage,
        ),
        build_reference_distribution(
            kind="sector",
            label=(
                sector_components[0].label
                if len(sector_components) == 1
                else "Sector context"
            ),
            frame=frame,
            components=sector_components,
            incident_grid=incident_grid,
            target_count=target_count,
            latitude=latitude,
            longitude=longitude,
            radius_m=radius_m,
            covered_area_share=sector_coverage,
        ),
        build_reference_distribution(
            kind="city",
            label="Citywide",
            frame=frame,
            components=city_components,
            incident_grid=incident_grid,
            target_count=target_count,
            latitude=latitude,
            longitude=longitude,
            radius_m=radius_m,
            covered_area_share=1.0,
        ),
    ]

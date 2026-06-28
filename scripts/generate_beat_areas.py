"""Generate the SPD beat data assets from the published SPD 2018-present beat
polygons: the per-beat geodesic area CSV (spherical excess) and the WGS84 polygon
GeoJSON used for point-in-polygon beat assignment. No GIS deps.

    .venv/bin/python scripts/generate_beat_areas.py \
        --out app/data/seattle_police_beats_2018_area.csv \
        --geojson-out app/data/seattle_police_beats_2018.geojson
"""
from __future__ import annotations

import argparse
import csv
import json
from math import radians, sin
from urllib.request import urlopen

EARTH_RADIUS_M = 6_371_008.8
# Official City of Seattle SPD GIS FeatureServer (org ZOyb2t4B0UYuYNYH, owner SPDGIS_Admin)
# for the current "Seattle Police Beats 2018-Present" administrative beats (2019-present geometry;
# the published 2018-present vintage). Public, token-free. We request WGS84 GeoJSON and measure
# true ground area with the geodesic (spherical-excess) formula below, so the service's native
# State Plane SR (EPSG:2926) and any Web Mercator twin are both avoided.
DEFAULT_URL = (
    "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/"
    "SPD_Beats_2019/FeatureServer/0/query"
    "?where=1%3D1&outFields=beat&outSR=4326&f=geojson"
)


def ring_area_m2(ring: list[list[float]]) -> float:
    total = 0.0
    n = len(ring)
    for i in range(n):
        lon1, lat1 = ring[i][0], ring[i][1]
        lon2, lat2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        total += radians(lon2 - lon1) * (2 + sin(radians(lat1)) + sin(radians(lat2)))
    return abs(total * EARTH_RADIUS_M * EARTH_RADIUS_M / 2.0)


def polygon_area_km2(coords: list) -> float:
    if not coords:
        return 0.0
    outer = ring_area_m2(coords[0])
    holes = sum(ring_area_m2(r) for r in coords[1:])
    return max(0.0, outer - holes) / 1_000_000.0


def _round_coords(node: object, precision: int) -> object:
    """Recursively round every coordinate in a GeoJSON geometry to ``precision``
    decimal places (~0.1 m at 6 dp), trimming on-disk size and float noise."""
    if isinstance(node, list):
        return [_round_coords(child, precision) for child in node]
    if isinstance(node, float):
        return round(node, precision)
    return node


def build_beats_geojson(features: list[dict], precision: int) -> dict:
    """A minimal WGS84 FeatureCollection carrying only ``beat`` + geometry, sorted by
    beat so the asset is reproducible (stable diffs) across regenerations."""
    out_features = []
    for feature in sorted(
        features, key=lambda f: (f.get("properties", {}).get("beat") or "")
    ):
        beat = (feature.get("properties", {}).get("beat") or "").strip()
        geom = feature.get("geometry") or {}
        if not beat or geom.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        out_features.append(
            {
                "type": "Feature",
                "properties": {"beat": beat},
                "geometry": {
                    "type": geom["type"],
                    "coordinates": _round_coords(geom["coordinates"], precision),
                },
            }
        )
    return {"type": "FeatureCollection", "features": out_features}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=DEFAULT_URL)
    parser.add_argument("--out", default="app/data/seattle_police_beats_2018_area.csv")
    parser.add_argument(
        "--geojson-out", default="app/data/seattle_police_beats_2018.geojson"
    )
    parser.add_argument("--coord-precision", type=int, default=6)
    args = parser.parse_args()

    with urlopen(args.url, timeout=60) as response:
        data = json.loads(response.read().decode("utf-8"))

    features = data.get("features", [])
    areas: dict[str, float] = {}
    for feature in features:
        beat = (feature.get("properties", {}).get("beat") or "").strip()
        geom = feature.get("geometry") or {}
        if not beat or geom.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        areas[beat] = areas.get(beat, 0.0) + sum(polygon_area_km2(p) for p in polys)

    if not areas:
        print("ERROR: no beats parsed — check URL and field name", flush=True)
        return 1

    with open(args.out, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["beat", "area_km2"])
        for beat in sorted(areas):
            writer.writerow([beat, round(areas[beat], 4)])
    print(f"wrote {len(areas)} beats to {args.out}")

    geojson = build_beats_geojson(features, args.coord_precision)
    with open(args.geojson_out, "w", encoding="utf-8") as handle:
        json.dump(geojson, handle, separators=(",", ":"))
        handle.write("\n")
    print(f"wrote {len(geojson['features'])} beat polygons to {args.geojson_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

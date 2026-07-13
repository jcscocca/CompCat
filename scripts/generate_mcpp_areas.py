"""Generate the SPD MCPP data assets from the published SPD MCPP polygons: the
per-neighborhood geodesic area CSV (spherical excess) and the WGS84 polygon GeoJSON
used for point-in-polygon MCPP assignment. No GIS deps.

    .venv/bin/python scripts/generate_mcpp_areas.py \
        --out app/data/seattle_mcpp_areas_area.csv \
        --geojson-out app/data/seattle_mcpp_areas.geojson
"""
from __future__ import annotations

import argparse
import csv
import json
from urllib.request import urlopen

from generate_beat_areas import _round_coords, polygon_area_km2

# Same official City of Seattle SPD GIS FeatureServer org as the beats asset
# (ZOyb2t4B0UYuYNYH, owner SPDGIS_Admin). Fields: neighborhood (UPPERCASE name,
# matches the SODA `mcpp` column's value style), precinct. Public, token-free.
DEFAULT_URL = (
    "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/"
    "MCPP/FeatureServer/0/query"
    "?where=1%3D1&outFields=neighborhood&outSR=4326&f=geojson"
)


def build_mcpp_geojson(features: list[dict], precision: int) -> dict:
    """A minimal WGS84 FeatureCollection carrying only ``mcpp`` + geometry, sorted by
    name so the asset is reproducible (stable diffs) across regenerations."""
    out_features = []
    for feature in sorted(
        features, key=lambda f: (f.get("properties", {}).get("neighborhood") or "")
    ):
        name = (feature.get("properties", {}).get("neighborhood") or "").strip().upper()
        geom = feature.get("geometry") or {}
        if not name or geom.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        out_features.append(
            {
                "type": "Feature",
                "properties": {"mcpp": name},
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
    parser.add_argument("--out", default="app/data/seattle_mcpp_areas_area.csv")
    parser.add_argument("--geojson-out", default="app/data/seattle_mcpp_areas.geojson")
    parser.add_argument("--coord-precision", type=int, default=6)
    args = parser.parse_args()

    with urlopen(args.url, timeout=60) as response:
        data = json.loads(response.read().decode("utf-8"))

    features = data.get("features", [])
    areas: dict[str, float] = {}
    for feature in features:
        name = (feature.get("properties", {}).get("neighborhood") or "").strip().upper()
        geom = feature.get("geometry") or {}
        if not name or geom.get("type") not in {"Polygon", "MultiPolygon"}:
            continue
        polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
        areas[name] = areas.get(name, 0.0) + sum(polygon_area_km2(p) for p in polys)

    if not areas:
        print("ERROR: no MCPP areas parsed — check URL and field name", flush=True)
        return 1

    with open(args.out, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["mcpp", "area_km2"])
        for name in sorted(areas):
            writer.writerow([name, round(areas[name], 4)])
    print(f"wrote {len(areas)} MCPP areas to {args.out}")

    geojson = build_mcpp_geojson(features, args.coord_precision)
    with open(args.geojson_out, "w", encoding="utf-8") as handle:
        json.dump(geojson, handle, separators=(",", ":"))
        handle.write("\n")
    print(f"wrote {len(geojson['features'])} MCPP polygons to {args.geojson_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

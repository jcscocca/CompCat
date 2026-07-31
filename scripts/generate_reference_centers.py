"""Generate the versioned street-segment midpoint frame used by reference circles.

The source is the City of Seattle's public Street Network Database (SND). The checked-in
artifact contains only one stable id, midpoint, street label, and CompCat geography
memberships per eligible segment; the much larger source linework is never shipped or
queried at runtime.

Eligibility is deliberately fixed to open, inside-Seattle, public street segments:

    CITYCODE = 1
    ACCESS_CODE = 1
    ST_CODE IN (0, 1, 2)
    SEGMENT_TYPE = 1

Regenerate from the repository root:

    .venv/bin/python scripts/generate_reference_centers.py \
        --out app/data/seattle_street_segment_midpoints_v1.csv \
        --metadata-out app/data/seattle_street_segment_midpoints_v1.json
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
from datetime import UTC, datetime
from math import cos, hypot, radians
from pathlib import Path
from urllib.parse import urlencode

import httpx

from app.analysis.area_baselines import load_mcpp_polygons, sector_for_beat
from app.analysis.beat_baselines import _point_in_polygon, assign_beat, load_beat_polygons

FRAME_VERSION = "seattle_snd_open_public_street_midpoints_v1"
SERVICE_ITEM_ID = "783fd63545304bdf9d3c5f2065751614"
LAYER_URL = (
    "https://services.arcgis.com/ZOyb2t4B0UYuYNYH/arcgis/rest/services/"
    "Street_Network_Database_SND/FeatureServer/0"
)
ELIGIBILITY_WHERE = (
    "CITYCODE=1 AND ACCESS_CODE=1 AND ST_CODE IN (0,1,2) AND SEGMENT_TYPE=1"
)
PAGE_SIZE = 2000


def _read_json(url: str) -> dict:
    response = httpx.get(url, timeout=120)
    response.raise_for_status()
    return response.json()


def _features(layer_url: str) -> list[dict]:
    rows: list[dict] = []
    offset = 0
    while True:
        query = urlencode(
            {
                "where": ELIGIBILITY_WHERE,
                "outFields": "OBJECTID,SND_ID,ORD_STNAME_CONCAT",
                "orderByFields": "OBJECTID",
                "outSR": "4326",
                "returnGeometry": "true",
                "resultOffset": offset,
                "resultRecordCount": PAGE_SIZE,
                "f": "geojson",
            }
        )
        page = _read_json(f"{layer_url}/query?{query}")
        features = page.get("features") or []
        rows.extend(features)
        if len(features) < PAGE_SIZE:
            break
        offset += len(features)
    return rows


def _line_parts(geometry: dict) -> list[list[list[float]]]:
    geom_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if geom_type == "LineString":
        return [coordinates]
    if geom_type == "MultiLineString":
        return coordinates
    return []


def line_midpoint(geometry: dict) -> tuple[float, float] | None:
    """Return the half-length point of WGS84 linework using a local metric projection."""
    parts = _line_parts(geometry)
    points = [point for part in parts for point in part]
    if not points:
        return None
    origin_lat = sum(float(point[1]) for point in points) / len(points)
    meters_per_lon = 111_320.0 * cos(radians(origin_lat))
    segments: list[tuple[list[float], list[float], float]] = []
    total = 0.0
    for part in parts:
        for start, end in zip(part, part[1:], strict=False):
            length = hypot(
                (float(end[0]) - float(start[0])) * meters_per_lon,
                (float(end[1]) - float(start[1])) * 111_320.0,
            )
            if length <= 0:
                continue
            segments.append((start, end, length))
            total += length
    if not segments:
        return float(points[0][0]), float(points[0][1])
    target = total / 2.0
    traveled = 0.0
    for start, end, length in segments:
        if traveled + length >= target:
            fraction = (target - traveled) / length
            return (
                float(start[0]) + fraction * (float(end[0]) - float(start[0])),
                float(start[1]) + fraction * (float(end[1]) - float(start[1])),
            )
        traveled += length
    last = segments[-1][1]
    return float(last[0]), float(last[1])


def _mcpp_memberships(lon: float, lat: float, polygons) -> list[str]:
    return sorted(
        name
        for name, multipolygon in polygons.items()
        if any(_point_in_polygon(lon, lat, rings) for rings in multipolygon)
    )


def build_rows(features: list[dict]) -> list[dict[str, str]]:
    beat_polygons = load_beat_polygons()
    mcpp_polygons = load_mcpp_polygons()
    rows: list[dict[str, str]] = []
    seen: set[str] = set()
    for feature in features:
        properties = feature.get("properties") or {}
        stable_id = properties.get("SND_ID")
        object_id = properties.get("OBJECTID")
        center_id = f"snd-{stable_id if stable_id is not None else f'oid-{object_id}'}"
        if center_id in seen:
            raise ValueError(f"duplicate reference center id: {center_id}")
        midpoint = line_midpoint(feature.get("geometry") or {})
        if midpoint is None:
            continue
        lon, lat = midpoint
        beat = assign_beat(lon, lat, beat_polygons)
        rows.append(
            {
                "center_id": center_id,
                "latitude": f"{lat:.6f}",
                "longitude": f"{lon:.6f}",
                "street_name": str(properties.get("ORD_STNAME_CONCAT") or "").strip(),
                "mcpps": "|".join(_mcpp_memberships(lon, lat, mcpp_polygons)),
                "sector": sector_for_beat(beat) or "",
            }
        )
        seen.add(center_id)
    return sorted(rows, key=lambda row: row["center_id"])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--layer-url", default=LAYER_URL)
    parser.add_argument("--out", default="app/data/seattle_street_segment_midpoints_v1.csv")
    parser.add_argument(
        "--metadata-out", default="app/data/seattle_street_segment_midpoints_v1.json"
    )
    args = parser.parse_args()

    layer_metadata = _read_json(f"{args.layer_url}?f=json")
    rows = build_rows(_features(args.layer_url))
    if not rows:
        print("ERROR: no reference centers generated", flush=True)
        return 1

    output_path = Path(args.out)
    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "center_id",
                "latitude",
                "longitude",
                "street_name",
                "mcpps",
                "sector",
            ],
            lineterminator="\n",
        )
        writer.writeheader()
        writer.writerows(rows)

    metadata = {
        "frame_version": FRAME_VERSION,
        "source": "City of Seattle Street Network Database (SND)",
        "service_item_id": SERVICE_ITEM_ID,
        "layer_url": args.layer_url,
        "source_data_last_edit_epoch_ms": (layer_metadata.get("editingInfo") or {}).get(
            "dataLastEditDate"
        ),
        "eligibility_where": ELIGIBILITY_WHERE,
        "center_definition": "half-length point of each eligible street segment",
        "generated_at_utc": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "center_count": len(rows),
        "sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
    }
    Path(args.metadata_out).write_text(
        json.dumps(metadata, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(rows)} reference centers to {args.out}")
    print(f"wrote frame metadata to {args.metadata_out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

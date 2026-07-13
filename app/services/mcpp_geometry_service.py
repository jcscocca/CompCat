"""Slimmed MCPP-polygon GeoJSON for the map/locator layers.

Mirrors beat_geometry_service: the bundled asset is a build artifact that never changes
at runtime, so both raw and gzip forms are cached for the process lifetime and the
route content-negotiates without re-serializing.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from app.analysis.area_baselines import DEFAULT_MCPP_GEOJSON, normalize_mcpp

_cache: tuple[bytes, bytes] | None = None


def reset_mcpp_cache() -> None:
    global _cache
    _cache = None


def mcpp_geojson_payloads(path: Path | None = None) -> tuple[bytes, bytes]:
    """Return (raw_json_bytes, gzip_bytes) of the slimmed FeatureCollection."""
    global _cache
    if _cache is not None and path is None:
        return _cache
    source = json.loads(Path(path or DEFAULT_MCPP_GEOJSON).read_text(encoding="utf-8"))
    features = []
    for feature in source.get("features", []):
        name = normalize_mcpp(str(feature.get("properties", {}).get("mcpp", "")))
        if not name:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"mcpp": name},
                "geometry": feature["geometry"],
            }
        )
    raw = json.dumps({"type": "FeatureCollection", "features": features}).encode("utf-8")
    payloads = (raw, gzip.compress(raw))
    if path is None:
        _cache = payloads
    return payloads

"""Slimmed beat-polygon GeoJSON for the map's beat-outline layer.

The bundled 2018 file's features carry only a ``beat`` property (no precinct/sector),
so slimming means dropping nothing but pinning the shape. Cached for the process
lifetime — the file is a build artifact that never changes at runtime; both forms are
held so the route can content-negotiate without re-serializing.
"""

from __future__ import annotations

import gzip
import json
from pathlib import Path

from app.analysis.beat_baselines import DEFAULT_BEATS_GEOJSON, NON_GEOGRAPHIC_BEATS

_cache: tuple[bytes, bytes] | None = None


def reset_beats_cache() -> None:
    global _cache
    _cache = None


def beats_geojson_payloads(path: Path | None = None) -> tuple[bytes, bytes]:
    """Return (raw_json_bytes, gzip_bytes) of the slimmed FeatureCollection."""
    global _cache
    if _cache is not None and path is None:
        return _cache
    source = json.loads(Path(path or DEFAULT_BEATS_GEOJSON).read_text(encoding="utf-8"))
    features = []
    for feature in source.get("features", []):
        beat = str(feature.get("properties", {}).get("beat", "")).strip()
        if not beat or beat in NON_GEOGRAPHIC_BEATS:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"beat": beat},
                "geometry": feature["geometry"],
            }
        )
    raw = json.dumps({"type": "FeatureCollection", "features": features}).encode("utf-8")
    payloads = (raw, gzip.compress(raw))
    if path is None:
        _cache = payloads
    return payloads

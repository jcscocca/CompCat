from __future__ import annotations

import pytest

from app.parsers.base import UnsupportedFormatError
from app.parsers.gpx_points import GpxPointsParser


def test_gpx_parser_reads_track_points() -> None:
    payload = b"""<?xml version="1.0" encoding="UTF-8"?>
    <gpx version="1.1">
      <trk><trkseg>
        <trkpt lat="47.6062" lon="-122.3321"><time>2026-07-30T12:00:00Z</time></trkpt>
      </trkseg></trk>
    </gpx>
    """

    result = GpxPointsParser().parse_bytes(payload, "track.gpx")

    assert len(result.observations) == 1
    assert result.observations[0].latitude == 47.6062
    assert result.observations[0].longitude == -122.3321


def test_gpx_parser_rejects_entity_expansion() -> None:
    payload = b"""<?xml version="1.0"?>
    <!DOCTYPE gpx [
      <!ENTITY repeat "sensitive-location">
    ]>
    <gpx><trk><trkseg><trkpt lat="47.6" lon="-122.3">&repeat;</trkpt></trkseg></trk></gpx>
    """

    with pytest.raises(UnsupportedFormatError, match="Invalid or unsafe GPX"):
        GpxPointsParser().parse_bytes(payload, "track.gpx")

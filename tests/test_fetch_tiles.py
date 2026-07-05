from __future__ import annotations

import json

from scripts.fetch_tiles import (
    GO_PMTILES_VERSION,
    SEATTLE_BBOX,
    extract_command,
    latest_build_name,
    release_asset_name,
)


def test_release_asset_name_covers_dev_and_deploy_platforms() -> None:
    assert release_asset_name("Darwin", "arm64") == (
        f"go-pmtiles_{GO_PMTILES_VERSION}_Darwin_arm64.zip"
    )
    assert release_asset_name("Linux", "x86_64") == (
        f"go-pmtiles_{GO_PMTILES_VERSION}_Linux_x86_64.tar.gz"
    )
    assert release_asset_name("Windows", "AMD64") == (
        f"go-pmtiles_{GO_PMTILES_VERSION}_Windows_x86_64.zip"
    )


def test_extract_command_is_bbox_scoped_and_capped_at_z15() -> None:
    cmd = extract_command("/tools/pmtiles", "20260628.pmtiles", "app/data/tiles/seattle.pmtiles")
    assert cmd[0] == "/tools/pmtiles"
    assert cmd[1] == "extract"
    assert cmd[2] == "https://build.protomaps.com/20260628.pmtiles"
    assert cmd[3] == "app/data/tiles/seattle.pmtiles"
    assert f"--bbox={SEATTLE_BBOX}" in cmd
    assert "--maxzoom=15" in cmd


def test_latest_build_name_picks_newest_pmtiles_key() -> None:
    listing = json.dumps(
        [
            {"key": "20260601.pmtiles"},
            {"key": "20260628.pmtiles"},
            {"key": "20260628.pmtiles.gz"},
        ]
    )
    assert latest_build_name(listing) == "20260628.pmtiles"

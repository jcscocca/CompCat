from __future__ import annotations

import io
import json
import tarfile
from pathlib import Path

import pytest

from scripts import fetch_tiles
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


def _assets_tarball_with_hostile_members(root: str) -> bytes:
    data = b"font-bytes"
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tf:
        ok = tarfile.TarInfo(f"{root}/fonts/ok.pbf")
        ok.size = len(data)
        tf.addfile(ok, io.BytesIO(data))
        evil = tarfile.TarInfo(f"{root}/fonts/../../evil.txt")
        evil.size = len(data)
        tf.addfile(evil, io.BytesIO(data))
        link = tarfile.TarInfo(f"{root}/fonts/link.pbf")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        tf.addfile(link)
    return buf.getvalue()


def test_fetch_assets_rejects_traversal_and_symlink_members(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    root = f"basemaps-assets-{fetch_tiles.ASSETS_COMMIT}"
    blob = _assets_tarball_with_hostile_members(root)
    out = tmp_path / "deep" / "basemaps-assets"
    monkeypatch.setattr(fetch_tiles, "ASSETS_OUT", out)
    monkeypatch.setattr(fetch_tiles, "_download", lambda url: blob)

    fetch_tiles.fetch_assets(force=False)

    assert (out / "fonts" / "ok.pbf").read_bytes() == b"font-bytes"
    escaped = [p for p in tmp_path.rglob("*") if p.name == "evil.txt"]
    assert escaped == []
    link_path = out / "fonts" / "link.pbf"
    assert not link_path.is_symlink()
    assert not link_path.exists()

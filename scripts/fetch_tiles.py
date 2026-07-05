"""Fetch the self-hosted basemap artifacts (kept out of git).

1. go-pmtiles CLI  -> .tools/            (release binary for this platform)
2. Seattle extract -> app/data/tiles/seattle.pmtiles  (from build.protomaps.com)
3. fonts + sprites -> frontend/public/basemaps-assets/ (from protomaps/basemaps-assets)

Stdlib only; runs on the Mac and the ThinkPad deploy host alike:
    python scripts/fetch_tiles.py [--build 20260628.pmtiles] [--force]
"""

from __future__ import annotations

import argparse
import io
import json
import platform
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

GO_PMTILES_VERSION = "1.30.3"
SEATTLE_BBOX = "-122.55,47.40,-122.10,47.80"
REPO = Path(__file__).resolve().parent.parent
TOOLS_DIR = REPO / ".tools"
TILES_OUT = REPO / "app" / "data" / "tiles" / "seattle.pmtiles"
ASSETS_OUT = REPO / "frontend" / "public" / "basemaps-assets"
BUILDS_URL = "https://build.protomaps.com"
# builds.json moved to a separate metadata host; tiles still stream from BUILDS_URL.
BUILDS_LISTING_URL = "https://build-metadata.protomaps.dev/builds.json"
ASSETS_COMMIT = "028c18f713baecad011301ff7a69acc39bcc2ae7"
ASSETS_TARBALL = f"https://github.com/protomaps/basemaps-assets/archive/{ASSETS_COMMIT}.tar.gz"


def release_asset_name(system: str, machine: str) -> str:
    machine_map = {"x86_64": "x86_64", "AMD64": "x86_64", "arm64": "arm64", "aarch64": "arm64"}
    arch = machine_map.get(machine, machine)
    ext = "zip" if system in {"Darwin", "Windows"} else "tar.gz"
    # Upstream is inconsistent: Darwin assets use a hyphen after "go-pmtiles",
    # Linux/Windows use an underscore.
    sep = "-" if system == "Darwin" else "_"
    return f"go-pmtiles{sep}{GO_PMTILES_VERSION}_{system}_{arch}.{ext}"


def extract_command(pmtiles_bin: str, build_name: str, out_path: str) -> list[str]:
    return [
        pmtiles_bin,
        "extract",
        f"{BUILDS_URL}/{build_name}",
        out_path,
        f"--bbox={SEATTLE_BBOX}",
        "--maxzoom=15",
    ]


def latest_build_name(listing_json: str) -> str:
    entries = json.loads(listing_json)
    keys = [e["key"] for e in entries if e.get("key", "").endswith(".pmtiles")]
    if not keys:
        raise SystemExit("no .pmtiles builds found in the build listing")
    return sorted(keys)[-1]


def _download(url: str) -> bytes:
    print(f"  fetching {url}")
    # Some hosts (build-metadata.protomaps.dev) 403 the default Python-urllib UA.
    req = urllib.request.Request(url, headers={"User-Agent": "waypoint-fetch-tiles"})
    with urllib.request.urlopen(req, timeout=90) as resp:  # noqa: S310 - fixed https hosts
        return resp.read()


def ensure_pmtiles_cli() -> str:
    on_path = shutil.which("pmtiles")
    if on_path:
        return on_path
    binary = TOOLS_DIR / ("pmtiles.exe" if platform.system() == "Windows" else "pmtiles")
    if binary.exists():
        return str(binary)
    TOOLS_DIR.mkdir(exist_ok=True)
    asset = release_asset_name(platform.system(), platform.machine())
    url = f"https://github.com/protomaps/go-pmtiles/releases/download/v{GO_PMTILES_VERSION}/{asset}"
    blob = _download(url)
    if asset.endswith(".zip"):
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            zf.extract(binary.name, TOOLS_DIR)
    else:
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
            tf.extract(binary.name, TOOLS_DIR)
    binary.chmod(0o755)
    return str(binary)


def fetch_tiles(build: str | None, force: bool) -> None:
    if TILES_OUT.exists() and not force:
        print(f"tiles already present: {TILES_OUT} (use --force to refetch)")
        return
    cli = ensure_pmtiles_cli()
    build_name = build or latest_build_name(_download(BUILDS_LISTING_URL).decode())
    TILES_OUT.parent.mkdir(parents=True, exist_ok=True)
    cmd = extract_command(cli, build_name, str(TILES_OUT))
    print("  " + " ".join(cmd))
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        raise SystemExit(
            f"pmtiles extract failed for build {build_name} (exit {e.returncode}); "
            f"check the build name at {BUILDS_LISTING_URL}"
        ) from e
    print(f"tiles written: {TILES_OUT} ({TILES_OUT.stat().st_size / 1e6:.0f} MB)")


def fetch_assets(force: bool) -> None:
    if ASSETS_OUT.exists() and not force:
        print(f"basemap assets already present: {ASSETS_OUT} (use --force to refetch)")
        return
    blob = _download(ASSETS_TARBALL)
    dest_root = ASSETS_OUT.resolve()
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        for member in tf.getmembers():
            parts = Path(member.name).parts  # basemaps-assets-<sha>/fonts/...
            if len(parts) < 2 or parts[1] not in {"fonts", "sprites"}:
                continue
            member.name = str(Path(*parts[1:]))
            target = (dest_root / member.name).resolve()
            if not target.is_relative_to(dest_root) or member.issym() or member.islnk():
                continue
            tf.extract(member, ASSETS_OUT)
    print(f"assets written: {ASSETS_OUT}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build", help="build file name, e.g. 20260628.pmtiles (default: latest)")
    parser.add_argument("--force", action="store_true", help="refetch even if artifacts exist")
    args = parser.parse_args()
    fetch_assets(args.force)
    fetch_tiles(args.build, args.force)


if __name__ == "__main__":
    sys.exit(main())

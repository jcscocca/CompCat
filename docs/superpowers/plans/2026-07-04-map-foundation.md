# Map Foundation (Slice 1 of Map & UI Overhaul) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Leaflet + Carto-CDN map with a MapLibre GL map running on a self-hosted Seattle PMTiles vector basemap, with light/dark Civic Clear style JSONs, graceful missing-tiles fallback, and deploy wiring — behavior-identical pins/rings/interactions.

**Architecture:** `maplibre-gl` renders vector tiles from a single `seattle.pmtiles` file served by the FastAPI backend as a static file with HTTP range support (`/tiles/`). Style JSONs are built at runtime from `@protomaps/basemaps` flavors recolored to the pinned Civic Clear palette; glyphs/sprites are self-hosted under `frontend/public/basemaps-assets/`. The tile artifact and assets are **not in git** — `make fetch-tiles` (a stdlib-only Python script) fetches them; a missing artifact degrades to a flat background + notice.

**Tech Stack:** maplibre-gl `^5.24.0`, pmtiles `^4.4.1` (JS protocol), `@protomaps/basemaps` `^5.7.2`, go-pmtiles CLI (fetched, not committed), FastAPI/Starlette 1.3.1 StaticFiles.

**Spec:** `docs/superpowers/specs/2026-07-04-map-ui-overhaul-design.md` (Slice 1 section).

**Working rules:** every commit leaves `make test-all` green. Leaflet is removed only in Task 8, *after* the MapLibre canvas is in and passing. Colors for pins/rings stay the current clay/slate in this slice (the shell re-theme is Slice 3); only the **basemap** gets the pinned Civic Clear colors.

## File structure

| File | Role |
|---|---|
| `frontend/src/lib/geodesy.ts` (new) | Pure geodesic circle-polygon helper for radius rings |
| `frontend/src/lib/mapStyle.ts` (new) | Pinned Civic Clear map palette, flavor overrides, `buildMapStyle`/`fallbackMapStyle`/`cartoRasterStyle`, `TILES_URL` |
| `frontend/src/components/MapCanvas.tsx` (rewrite) | MapLibre map lifecycle, markers, rings, flyTo, click, fallback notice |
| `frontend/src/lib/mapTiles.ts` (delete in Task 7) | Superseded by `mapStyle.ts` |
| `app/config.py` (modify) | `tiles_dir` setting |
| `app/main.py` (modify) | `/tiles` StaticFiles mount |
| `scripts/fetch_tiles.py` (new) | Fetch go-pmtiles CLI, extract Seattle PMTiles, fetch basemaps assets |
| `tests/test_tiles_static.py` (new) | Range (206) + missing-file (404) behavior |
| `tests/test_fetch_tiles.py` (new) | Pure helper tests for the fetch script |
| `Makefile`, `.gitignore`, `frontend/vite.config.ts`, `frontend/src/main.tsx`, `frontend/src/components/MapWorkspace.tsx`, `frontend/src/styles/mapWorkspace.css` | Small wiring edits |
| `docker-compose.yml`, `scripts/start-waypoint.ps1`, `docs/DEPLOY.md` | Deploy wiring |

---

### Task 1: Add the MapLibre dependency stack (Leaflet stays for now)

**Files:**
- Modify: `frontend/package.json` (via npm)

- [ ] **Step 1: Install the new packages**

```bash
cd frontend && npm install maplibre-gl@^5.24.0 pmtiles@^4.4.1 @protomaps/basemaps@^5.7.2
```

- [ ] **Step 2: Verify the toolchain still passes**

Run: `cd frontend && npm run lint && npm test`
Expected: tsc clean; 243 tests pass (nothing imports the new packages yet).

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build(frontend): add maplibre-gl + pmtiles + @protomaps/basemaps"
```

---

### Task 2: Geodesic circle helper (`geodesy.ts`)

Rings were Leaflet `<Circle>`s (meters). MapLibre has no metric circle primitive, so we generate a polygon.

**Files:**
- Create: `frontend/src/lib/geodesy.ts`
- Test: `frontend/src/lib/geodesy.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/geodesy.test.ts
import { describe, expect, it } from "vitest";
import { circlePolygonCoords } from "./geodesy";

// Haversine, for verifying ring points sit at the requested radius.
function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371008.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

describe("circlePolygonCoords", () => {
  it("returns a closed ring of steps+1 [lng,lat] pairs", () => {
    const ring = circlePolygonCoords(47.6062, -122.3321, 250, 64);
    expect(ring).toHaveLength(65);
    expect(ring[0]).toEqual(ring[64]);
  });

  it("places every vertex within 1% of the requested radius at Seattle latitude", () => {
    const ring = circlePolygonCoords(47.6062, -122.3321, 500, 64);
    for (const [lng, lat] of ring) {
      const d = haversineM(47.6062, -122.3321, lat, lng);
      expect(Math.abs(d - 500)).toBeLessThan(5);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/geodesy.test.ts`
Expected: FAIL — `Cannot find module './geodesy'`

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/lib/geodesy.ts
const EARTH_RADIUS_M = 6371008.8;

/** Ring of [lng, lat] pairs approximating a metric circle; closed (first == last). */
export function circlePolygonCoords(
  lat: number,
  lng: number,
  radiusM: number,
  steps = 64,
): [number, number][] {
  const latRad = (lat * Math.PI) / 180;
  const dLat = (radiusM / EARTH_RADIUS_M) * (180 / Math.PI);
  const dLng = dLat / Math.cos(latRad);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = (i / steps) * 2 * Math.PI;
    ring.push([lng + dLng * Math.cos(theta), lat + dLat * Math.sin(theta)]);
  }
  return ring;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/geodesy.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/geodesy.ts frontend/src/lib/geodesy.test.ts
git commit -m "feat(map): geodesic circle polygon helper for radius rings"
```

---

### Task 3: Map style builder (`mapStyle.ts`) with pinned Civic Clear palette

**Files:**
- Create: `frontend/src/lib/mapStyle.ts`
- Test: `frontend/src/lib/mapStyle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// frontend/src/lib/mapStyle.test.ts
import { describe, expect, it } from "vitest";
import {
  buildMapStyle,
  CIVIC_MAP_COLORS,
  cartoRasterStyle,
  fallbackMapStyle,
  TILES_URL,
} from "./mapStyle";

describe("buildMapStyle", () => {
  it("points the vector source at the self-hosted PMTiles file via the pmtiles protocol", () => {
    const style = buildMapStyle("light", "http://localhost:8000");
    const source = style.sources.protomaps as { type: string; url?: string };
    expect(source.type).toBe("vector");
    expect(source.url).toBe(`pmtiles://http://localhost:8000${TILES_URL}`);
  });

  it("self-hosts glyphs and sprites (no external hosts)", () => {
    const style = buildMapStyle("dark", "http://localhost:8000");
    expect(style.glyphs).toBe("http://localhost:8000/basemaps-assets/fonts/{fontstack}/{range}.pbf");
    expect(String(style.sprite)).toContain("http://localhost:8000/basemaps-assets/sprites/");
    const externals = JSON.stringify(style).match(/https?:\/\/(?!localhost:8000)[^"]+/g) ?? [];
    // Attribution links are the only allowed external URLs.
    for (const url of externals) {
      expect(url).toMatch(/openstreetmap\.org|protomaps\.com/);
    }
  });

  it("produces a non-empty basemap layer list for both themes", () => {
    expect(buildMapStyle("light", "http://x").layers.length).toBeGreaterThan(10);
    expect(buildMapStyle("dark", "http://x").layers.length).toBeGreaterThan(10);
  });

  it("credits OpenStreetMap in the source attribution", () => {
    const source = buildMapStyle("light", "http://x").sources.protomaps as { attribution?: string };
    expect(source.attribution).toContain("OpenStreetMap");
  });
});

describe("fallbackMapStyle", () => {
  it("is a background-only style using the pinned civic background color", () => {
    const style = fallbackMapStyle("light");
    expect(style.layers).toHaveLength(1);
    expect(style.layers[0].type).toBe("background");
    expect(JSON.stringify(style)).toContain(CIVIC_MAP_COLORS.light.background);
  });
});

describe("cartoRasterStyle", () => {
  it("keeps the temporary Carto raster fallback reachable behind the dev flag", () => {
    const style = cartoRasterStyle();
    const source = style.sources.carto as { type: string; tiles?: string[] };
    expect(source.type).toBe("raster");
    expect(source.tiles?.[0]).toContain("basemaps.cartocdn.com");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/mapStyle.test.ts`
Expected: FAIL — `Cannot find module './mapStyle'`

- [ ] **Step 3: Write the implementation**

```ts
// frontend/src/lib/mapStyle.ts
import { layers, namedFlavor, type Flavor } from "@protomaps/basemaps";
import type { StyleSpecification } from "maplibre-gl";

export const TILES_URL = "/tiles/seattle.pmtiles";

export type MapTheme = "light" | "dark";

// The Civic Clear map palette, pinned per the 2026-07-04 map-ui-overhaul spec.
// Slice 3 (shell re-theme) reuses these values as CSS tokens.
export const CIVIC_MAP_COLORS: Record<
  MapTheme,
  { background: string; earth: string; water: string; park: string }
> = {
  light: { background: "#EDF1F4", earth: "#F2F5F7", water: "#D3E3EC", park: "#DBEADF" },
  dark: { background: "#141A20", earth: "#161D24", water: "#0F2430", park: "#16241C" },
};

const ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://protomaps.com">Protomaps</a>';

function civicFlavor(theme: MapTheme): Flavor {
  const base = namedFlavor(theme);
  const c = CIVIC_MAP_COLORS[theme];
  // Override only the broad ground colors; roads/labels keep the flavor's tuning.
  // Key names are typechecked against Flavor — if a key is renamed upstream,
  // tsc points at the exact line.
  return {
    ...base,
    background: c.background,
    earth: c.earth,
    water: c.water,
    park_a: c.park,
    park_b: c.park,
  };
}

export function buildMapStyle(theme: MapTheme, origin: string): StyleSpecification {
  return {
    version: 8,
    glyphs: `${origin}/basemaps-assets/fonts/{fontstack}/{range}.pbf`,
    sprite: `${origin}/basemaps-assets/sprites/v4/${theme}`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${origin}${TILES_URL}`,
        attribution: ATTRIBUTION,
      },
    },
    layers: layers("protomaps", civicFlavor(theme), { lang: "en" }),
  };
}

/** Used when the tile artifact is missing: flat background, overlays still render. */
export function fallbackMapStyle(theme: MapTheme): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": CIVIC_MAP_COLORS[theme].background },
      },
    ],
  };
}

// Temporary escape hatch while the tile-artifact pipeline is being proven:
// VITE_MAP_BASEMAP=carto restores the old Carto raster basemap. Delete once
// the PMTiles pipeline has run on the deploy host.
export function cartoRasterStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      carto: {
        type: "raster",
        tiles: [
          "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
          "https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
        ],
        tileSize: 256,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      },
    },
    layers: [{ id: "carto", type: "raster", source: "carto" }],
  };
}
```

- [ ] **Step 4: Run test; fix Flavor key names if tsc objects**

Run: `cd frontend && npx vitest run src/lib/mapStyle.test.ts && npm run lint`
Expected: PASS (6 tests), tsc clean. If tsc rejects `park_a`/`park_b` (or `earth`), open the `Flavor` type in `node_modules/@protomaps/basemaps/dist/index.d.ts` and use the actual key names for background/earth/water/park — the four pinned colors are the requirement, the key names are not.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/mapStyle.ts frontend/src/lib/mapStyle.test.ts
git commit -m "feat(map): civic light/dark style builder over self-hosted pmtiles"
```

---

### Task 4: Backend `/tiles` static mount with range support

**Files:**
- Modify: `app/config.py` (add one setting after `static_dashboard_dir`, line 21)
- Modify: `app/main.py` (mount in `create_app`)
- Test: `tests/test_tiles_static.py`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_tiles_static.py
from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app


def _client(tmp_path, monkeypatch) -> TestClient:
    monkeypatch.setenv("MCA_TILES_DIR", str(tmp_path))
    return TestClient(create_app("sqlite+pysqlite:///:memory:"))


def test_tiles_file_served_with_byte_ranges(tmp_path, monkeypatch) -> None:
    # PMTiles clients read the file via HTTP Range requests; 206 support is load-bearing.
    (tmp_path / "seattle.pmtiles").write_bytes(b"PMTiles-test-payload")
    client = _client(tmp_path, monkeypatch)

    full = client.get("/tiles/seattle.pmtiles")
    assert full.status_code == 200

    part = client.get("/tiles/seattle.pmtiles", headers={"Range": "bytes=0-6"})
    assert part.status_code == 206
    assert part.content == b"PMTiles"


def test_missing_tiles_file_is_404_not_boot_failure(tmp_path, monkeypatch) -> None:
    client = _client(tmp_path, monkeypatch)
    assert client.get("/tiles/seattle.pmtiles").status_code == 404
    # The rest of the app still works without the artifact.
    assert client.get("/health").status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_tiles_static.py -q`
Expected: FAIL — 404 on both (no mount yet); the range test fails first.

- [ ] **Step 3: Add the setting and the mount**

In `app/config.py`, after `static_dashboard_dir: str = "app/static/dashboard"` (line 21):

```python
    tiles_dir: str = "app/data/tiles"
```

In `app/main.py`, inside `create_app` immediately before `mount_dashboard(app)`:

```python
    # Self-hosted basemap tiles (see docs/superpowers/specs/2026-07-04-map-ui-overhaul-design.md).
    # check_dir=False: the artifact is fetched out-of-band (make fetch-tiles); missing file
    # is a plain 404 and the frontend falls back to a flat basemap.
    app.mount(
        "/tiles",
        StaticFiles(directory=get_settings().tiles_dir, check_dir=False),
        name="tiles",
    )
```

(`StaticFiles`, `Path`, and `get_settings` are already imported in `app/main.py`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_tiles_static.py -q`
Expected: PASS (2 tests). If the range assertion returns 200 with the full body instead of 206, Starlette's StaticFiles isn't honoring Range — per the spec, replace the mount with a small range-aware endpoint (read the requested slice with `Path.open` + `seek`, return `Response(content, status_code=206, headers={"Content-Range": ...})`). Do not skip the test.

- [ ] **Step 5: Run the API-tier guard**

Run: `.venv/bin/python -m pytest tests/test_internal_surface.py -q`
Expected: PASS — `/tiles` is a static mount, not an API route; if the guard flags it, exempt it the same way `/assets` is handled there.

- [ ] **Step 6: Commit**

```bash
git add app/config.py app/main.py tests/test_tiles_static.py
git commit -m "feat(tiles): serve self-hosted pmtiles artifact with range support"
```

---

### Task 5: `scripts/fetch_tiles.py` + Makefile target + gitignore

Stdlib-only so it runs on the Mac (dev) and the ThinkPad (deploy host, plain `python`). It (a) ensures the go-pmtiles CLI, (b) extracts a Seattle-metro PMTiles from the Protomaps build bucket, (c) fetches the basemaps fonts/sprites.

**Files:**
- Create: `scripts/fetch_tiles.py`
- Test: `tests/test_fetch_tiles.py`
- Modify: `Makefile`, `.gitignore`

- [ ] **Step 1: Write the failing test (pure helpers only — no network)**

```python
# tests/test_fetch_tiles.py
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_fetch_tiles.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'scripts.fetch_tiles'`

- [ ] **Step 3: Write the script**

```python
# scripts/fetch_tiles.py
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

GO_PMTILES_VERSION = "1.28.0"
SEATTLE_BBOX = "-122.55,47.40,-122.10,47.80"
REPO = Path(__file__).resolve().parent.parent
TOOLS_DIR = REPO / ".tools"
TILES_OUT = REPO / "app" / "data" / "tiles" / "seattle.pmtiles"
ASSETS_OUT = REPO / "frontend" / "public" / "basemaps-assets"
BUILDS_URL = "https://build.protomaps.com"
ASSETS_TARBALL = "https://github.com/protomaps/basemaps-assets/archive/refs/heads/main.tar.gz"


def release_asset_name(system: str, machine: str) -> str:
    machine_map = {"x86_64": "x86_64", "AMD64": "x86_64", "arm64": "arm64", "aarch64": "arm64"}
    arch = machine_map.get(machine, machine)
    ext = "zip" if system in {"Darwin", "Windows"} else "tar.gz"
    return f"go-pmtiles_{GO_PMTILES_VERSION}_{system}_{arch}.{ext}"


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
    with urllib.request.urlopen(url) as resp:  # noqa: S310 - fixed https hosts
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
    build_name = build or latest_build_name(_download(f"{BUILDS_URL}/builds.json").decode())
    TILES_OUT.parent.mkdir(parents=True, exist_ok=True)
    cmd = extract_command(cli, build_name, str(TILES_OUT))
    print("  " + " ".join(cmd))
    subprocess.run(cmd, check=True)
    print(f"tiles written: {TILES_OUT} ({TILES_OUT.stat().st_size / 1e6:.0f} MB)")


def fetch_assets(force: bool) -> None:
    if ASSETS_OUT.exists() and not force:
        print(f"basemap assets already present: {ASSETS_OUT} (use --force to refetch)")
        return
    blob = _download(ASSETS_TARBALL)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        for member in tf.getmembers():
            parts = Path(member.name).parts  # basemaps-assets-main/fonts/...
            if len(parts) < 2 or parts[1] not in {"fonts", "sprites"}:
                continue
            member.name = str(Path(*parts[1:]))
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_fetch_tiles.py -q && .venv/bin/ruff check scripts/fetch_tiles.py`
Expected: PASS (3 tests), ruff clean. (If `scripts` isn't importable as a package, check for `scripts/__init__.py` — `scripts/soak/__init__.py` exists, so the pattern is established; add `scripts/__init__.py` if missing.)

- [ ] **Step 5: Add the Makefile target and gitignore entries**

In `Makefile`: add `fetch-tiles` to the `.PHONY` line, and after the `seed-calls`/`ingest-calls` block:

```makefile
fetch-tiles:
	.venv/bin/python scripts/fetch_tiles.py
```

In `.gitignore`, append:

```
app/data/tiles/
frontend/public/basemaps-assets/
.tools/
```

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch_tiles.py tests/test_fetch_tiles.py Makefile .gitignore
git commit -m "feat(tiles): fetch script for pmtiles extract + basemap assets"
```

---

### Task 6: Fetch the real artifacts (network step)

- [ ] **Step 1: Run the fetch**

Run: `make fetch-tiles`
Expected: assets land in `frontend/public/basemaps-assets/{fonts,sprites}/`; extract streams for a few minutes, then `tiles written: .../seattle.pmtiles (~50–120 MB)`.

**If `builds.json` has a different shape or 404s:** open https://build.protomaps.com in a browser, pick the newest `YYYYMMDD.pmtiles`, and run `.venv/bin/python scripts/fetch_tiles.py --build <name>`; then fix `latest_build_name` (and its test) to match the real listing shape.

- [ ] **Step 2: Prove range serving end-to-end**

```bash
make run &   # or use the already-running dev server
sleep 2 && curl -sI -H "Range: bytes=0-99" http://127.0.0.1:8000/tiles/seattle.pmtiles | head -3
```

Expected: `HTTP/1.1 206 Partial Content`.

- [ ] **Step 3: Confirm git stays clean**

Run: `git status --porcelain`
Expected: empty (artifacts are all ignored). Nothing to commit for this task.

---

### Task 7: Rewrite MapCanvas on MapLibre

**Files:**
- Rewrite: `frontend/src/components/MapCanvas.tsx`
- Rewrite: `frontend/src/components/MapCanvas.test.tsx`
- Delete: `frontend/src/lib/mapTiles.ts`, `frontend/src/lib/mapTiles.test.ts`
- Modify: `frontend/src/components/MapWorkspace.tsx` (drop `tileConfig`), `frontend/src/main.tsx` (CSS import), `frontend/vite.config.ts` (proxy), `frontend/src/styles/mapWorkspace.css` (canvas + fallback-notice rules)

- [ ] **Step 1: Write the new failing tests**

Replace `frontend/src/components/MapCanvas.test.tsx` entirely:

```tsx
// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// maplibre-gl needs WebGL; mock the whole module. Markers append their element to
// document.body so testing-library queries can see them.
vi.mock("maplibre-gl", () => {
  class MockMap {
    handlers: Record<string, Array<(arg?: unknown) => void>> = {};
    on(event: string, cb: (arg?: unknown) => void) {
      (this.handlers[event] ??= []).push(cb);
      if (event === "load") cb();
      return this;
    }
    once(event: string, cb: (arg?: unknown) => void) {
      return this.on(event, cb);
    }
    addSource() {}
    getSource() {
      return { setData: vi.fn() };
    }
    addLayer() {}
    addControl() {}
    getZoom() {
      return 12;
    }
    flyTo = vi.fn();
    remove() {}
    fireClick(lat: number, lng: number) {
      for (const cb of this.handlers.click ?? []) cb({ lngLat: { lat, lng } });
    }
  }
  class MockMarker {
    element: HTMLElement;
    constructor(opts: { element: HTMLElement }) {
      this.element = opts.element;
    }
    setLngLat(ll: [number, number]) {
      this.element.dataset.lnglat = ll.join(",");
      return this;
    }
    addTo() {
      document.body.appendChild(this.element);
      return this;
    }
    remove() {
      this.element.remove();
    }
  }
  return { default: { Map: MockMap, Marker: MockMarker, addProtocol: vi.fn() } };
});

vi.mock("pmtiles", () => ({ Protocol: class { tile = vi.fn(); } }));

import { MapCanvas, iconHtml, markerKindFor, ringsGeoJSON } from "./MapCanvas";
import type { DashboardSummary, Place } from "../types";

const place: Place = {
  id: "p1",
  display_label: "Home",
  latitude: 47.61,
  longitude: -122.33,
  visit_count: 5,
  total_dwell_minutes: null,
  inferred_place_type: "manual_place",
  sensitivity_class: "normal",
};

function summaryWithCount(): DashboardSummary {
  return {
    totals: { place_count: 1, visit_count: 5, incident_count: 9 },
    privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
    places: [place],
    crime_summaries: [
      {
        place_cluster_id: "p1",
        radius_m: 250,
        analysis_start_date: "2026-01-01",
        analysis_end_date: "2026-06-24",
        offense_category: null,
        offense_subcategory: null,
        nibrs_group: null,
        incident_count: 9,
        nearest_incident_m: null,
        incidents_per_visit: null,
        incidents_per_hour_dwell: null,
      },
    ],
    analysis: { available_radii_m: [250] },
    exports: { tableau_place_summary_csv: "/x.csv" },
  };
}

const noop = () => {};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

function renderCanvas(over: Partial<Parameters<typeof MapCanvas>[0]> = {}) {
  return render(
    <MapCanvas places={[place]} selectedIds={new Set()} draft={null} addPinMode={false}
      summary={null} radiusM={250} flyTo={null} onMapClick={noop} onMarkerClick={noop} {...over} />,
  );
}

describe("markerKindFor", () => {
  it("classifies analyzed, low-data, selected, and default places", () => {
    const s = summaryWithCount();
    expect(markerKindFor(place, new Set(), s, 250)).toBe("analyzed");
    const other: Place = { ...place, id: "p2" };
    expect(markerKindFor(other, new Set(["p2"]), s, 250)).toBe("low");
    expect(markerKindFor(other, new Set(["p2"]), null, 250)).toBe("selected");
    expect(markerKindFor(other, new Set(), null, 250)).toBe("default");
  });
});

describe("iconHtml", () => {
  it("escapes selected place labels before injecting marker HTML", () => {
    const html = iconHtml("selected", { label: '<img src=x onerror="alert(1)">' });
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
  });
});

describe("ringsGeoJSON", () => {
  it("emits one polygon per analyzed/low place with the kind tagged", () => {
    const fc = ringsGeoJSON([place], new Set(), summaryWithCount(), 250);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties?.kind).toBe("analyzed");
    expect(fc.features[0].geometry.type).toBe("Polygon");
  });

  it("emits nothing for unanalyzed places", () => {
    const fc = ringsGeoJSON([place], new Set(), null, 250);
    expect(fc.features).toHaveLength(0);
  });
});

describe("MapCanvas", () => {
  it("renders one marker element per place and reports clicks by id", async () => {
    const onMarkerClick = vi.fn();
    renderCanvas({ onMarkerClick });
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(1));
    (document.body.querySelector(".mc-pin-icon") as HTMLElement).click();
    expect(onMarkerClick).toHaveBeenCalledWith("p1");
  });

  it("renders a draft marker in addition to place markers", async () => {
    renderCanvas({
      draft: { latitude: 47.6, longitude: -122.3, display_label: "", visit_count: 1, sensitivity_class: "normal", source: "map" },
      addPinMode: true,
    });
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(2));
  });

  it("shows the fallback notice when the tile artifact is missing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    renderCanvas();
    expect(await screen.findByText(/basemap tiles unavailable/i)).toBeInTheDocument();
  });

  it("skips places without coordinates", async () => {
    renderCanvas({ places: [{ ...place, latitude: null, longitude: null }] });
    await waitFor(() => expect(document.body.querySelectorAll(".mc-pin-icon")).toHaveLength(0));
  });
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd frontend && npx vitest run src/components/MapCanvas.test.tsx`
Expected: FAIL — `MapCanvas` has no exports `markerKindFor` / `ringsGeoJSON` / `iconHtml`, and props no longer match.

- [ ] **Step 3: Rewrite `MapCanvas.tsx`**

```tsx
// frontend/src/components/MapCanvas.tsx
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";

import { circlePolygonCoords } from "../lib/geodesy";
import { incidentCountForPlace } from "../lib/incidentSummaries";
import { buildMapStyle, cartoRasterStyle, fallbackMapStyle, TILES_URL } from "../lib/mapStyle";
import type { DashboardSummary, DraftPin, LatLng, Place } from "../types";

const SEATTLE: [number, number] = [-122.3321, 47.6062]; // [lng, lat]

export type MarkerKind = "default" | "selected" | "analyzed" | "low";

const DOT = '<circle cx="12" cy="11.5" r="4.4" fill="#fff"/>';
const QGLYPH = '<text x="12" y="16" font-size="13" fill="#fff" text-anchor="middle" font-family="Archivo" font-weight="700">?</text>';
const HTML_ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function teardrop(fill: string, glyph: string): string {
  return `<svg width="28" height="36" viewBox="0 0 24 32"><path d="M12 0C5.4 0 0 5.2 0 11.6 0 20 12 32 12 32s12-12 12-20.4C24 5.2 18.6 0 12 0z" fill="${fill}"/>${glyph}</svg>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ENTITIES[char]);
}

export function iconHtml(kind: MarkerKind, opts: { count?: number | null; label?: string }): string {
  if (kind === "selected") {
    const label = opts.label ? escapeHtml(opts.label) : "";
    return `<span class="mc-pin-halo"></span>${teardrop("#CD6A45", DOT)}<span class="mc-pin-tag">${label}</span>`;
  }
  if (kind === "analyzed") {
    return `${teardrop("#3A3F46", DOT)}<span class="mc-pin-badge"><b>${opts.count ?? 0}</b><i>inc.</i></span>`;
  }
  if (kind === "low") {
    return teardrop("#74858E", QGLYPH);
  }
  return teardrop("#3A3F46", DOT);
}

export function markerKindFor(
  place: Place,
  selectedIds: Set<string>,
  summary: DashboardSummary | null,
  radiusM: number,
): MarkerKind {
  const analyzedAtRadius = summary?.crime_summaries.some((entry) => entry.radius_m === radiusM) ?? false;
  if (incidentCountForPlace(summary, place.id, radiusM) !== null) {
    return "analyzed";
  }
  if (analyzedAtRadius && selectedIds.has(place.id)) {
    return "low";
  }
  if (selectedIds.has(place.id)) {
    return "selected";
  }
  return "default";
}

type RingFeature = {
  type: "Feature";
  properties: { kind: "analyzed" | "low" };
  geometry: { type: "Polygon"; coordinates: [number, number][][] };
};

export function ringsGeoJSON(
  places: Place[],
  selectedIds: Set<string>,
  summary: DashboardSummary | null,
  radiusM: number,
): { type: "FeatureCollection"; features: RingFeature[] } {
  const features: RingFeature[] = [];
  for (const place of places) {
    if (place.latitude === null || place.longitude === null) continue;
    const kind = markerKindFor(place, selectedIds, summary, radiusM);
    if (kind !== "analyzed" && kind !== "low") continue;
    features.push({
      type: "Feature",
      properties: { kind },
      geometry: {
        type: "Polygon",
        coordinates: [circlePolygonCoords(place.latitude, place.longitude, radiusM)],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

const RINGS_SOURCE = "mc-rings";

function addRingLayers(map: maplibregl.Map): void {
  map.addSource(RINGS_SOURCE, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  map.addLayer({
    id: "mc-ring-fill",
    type: "fill",
    source: RINGS_SOURCE,
    paint: {
      "fill-color": ["match", ["get", "kind"], "analyzed", "#CD6A45", "#74858E"],
      "fill-opacity": ["match", ["get", "kind"], "analyzed", 0.15, 0.12],
    },
  });
  map.addLayer({
    id: "mc-ring-line",
    type: "line",
    source: RINGS_SOURCE,
    filter: ["==", ["get", "kind"], "analyzed"],
    paint: { "line-color": "#CD6A45", "line-width": 1.5 },
  });
  map.addLayer({
    id: "mc-ring-line-dashed",
    type: "line",
    source: RINGS_SOURCE,
    filter: ["==", ["get", "kind"], "low"],
    paint: { "line-color": "#74858E", "line-width": 1.5, "line-dasharray": [2, 2] },
  });
}

let pmtilesProtocolRegistered = false;
function ensurePmtilesProtocol(): void {
  if (!pmtilesProtocolRegistered) {
    maplibregl.addProtocol("pmtiles", new Protocol().tile);
    pmtilesProtocolRegistered = true;
  }
}

type Props = {
  places: Place[];
  selectedIds: Set<string>;
  draft: DraftPin | null;
  addPinMode: boolean;
  summary: DashboardSummary | null;
  radiusM: number;
  flyTo: LatLng | null;
  onMapClick: (latlng: LatLng) => void;
  onMarkerClick: (placeId: string) => void;
};

export function MapCanvas({
  places,
  selectedIds,
  draft,
  addPinMode,
  summary,
  radiusM,
  flyTo,
  onMapClick,
  onMarkerClick,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const onMapClickRef = useRef(onMapClick);
  const onMarkerClickRef = useRef(onMarkerClick);
  const [mapReady, setMapReady] = useState(false);
  const [tilesMissing, setTilesMissing] = useState(false);

  onMapClickRef.current = onMapClick;
  onMarkerClickRef.current = onMarkerClick;

  useEffect(() => {
    let cancelled = false;
    async function init() {
      ensurePmtilesProtocol();
      const useCarto = import.meta.env.VITE_MAP_BASEMAP === "carto";
      const available = useCarto
        ? true
        : await fetch(TILES_URL, { method: "HEAD" }).then((r) => r.ok).catch(() => false);
      if (cancelled || !containerRef.current) return;
      setTilesMissing(!useCarto && !available);
      const style = useCarto
        ? cartoRasterStyle()
        : available
          ? buildMapStyle("light", window.location.origin)
          : fallbackMapStyle("light");
      const map = new maplibregl.Map({
        container: containerRef.current,
        style,
        center: SEATTLE,
        zoom: 12,
        attributionControl: { compact: true },
      });
      map.on("click", (event) => {
        onMapClickRef.current({ lat: event.lngLat.lat, lng: event.lngLat.lng });
      });
      map.on("load", () => {
        addRingLayers(map);
        setMapReady(true);
      });
      mapRef.current = map;
    }
    init();
    return () => {
      cancelled = true;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    for (const place of places) {
      if (place.latitude === null || place.longitude === null) continue;
      const kind = markerKindFor(place, selectedIds, summary, radiusM);
      const count = incidentCountForPlace(summary, place.id, radiusM);
      const el = document.createElement("div");
      el.className = "mc-pin-icon";
      el.innerHTML = iconHtml(kind, { count, label: place.display_label });
      el.addEventListener("click", (event) => {
        event.stopPropagation();
        onMarkerClickRef.current(place.id);
      });
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([place.longitude, place.latitude])
          .addTo(map),
      );
    }
    if (draft) {
      const el = document.createElement("div");
      el.className = "mc-pin-icon mc-pin-draft";
      el.innerHTML = teardrop("#B5512F", DOT);
      markersRef.current.push(
        new maplibregl.Marker({ element: el, anchor: "bottom" })
          .setLngLat([draft.longitude, draft.latitude])
          .addTo(map),
      );
    }
  }, [places, selectedIds, summary, radiusM, draft, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource(RINGS_SOURCE) as maplibregl.GeoJSONSource | undefined;
    source?.setData(ringsGeoJSON(places, selectedIds, summary, radiusM));
  }, [places, selectedIds, summary, radiusM, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyTo) return;
    map.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: Math.max(map.getZoom(), 15) });
  }, [flyTo, mapReady]);

  return (
    <div className={`mc-map${addPinMode ? " is-adding" : ""}`}>
      <div ref={containerRef} className="mc-map-canvas" />
      {tilesMissing ? (
        <div className="mc-map-fallback" role="status">
          Basemap tiles unavailable — run <code>make fetch-tiles</code>. Pins and analysis still work.
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire the surroundings**

`frontend/src/main.tsx` line 4 — replace:

```ts
import "leaflet/dist/leaflet.css";
```

with:

```ts
import "maplibre-gl/dist/maplibre-gl.css";
```

`frontend/src/components/MapWorkspace.tsx` — delete line 8 (`import { defaultTileConfig } from "../lib/mapTiles";`) and the `tileConfig={defaultTileConfig}` prop at line 307.

`frontend/vite.config.ts` — add `"/tiles": backendTarget,` to the `server.proxy` map (after `"/assistant"`).

`frontend/src/styles/mapWorkspace.css` — after the `.mc-map{position:absolute;inset:0;}` rule add:

```css
.mc-map-canvas{position:absolute;inset:0;}
.mc-map-fallback{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);z-index:30;
  padding:8px 14px;border-radius:8px;background:rgba(27,30,34,0.88);color:#F3F1EB;
  font-size:12.5px;box-shadow:0 8px 20px -10px rgba(0,0,0,.5);}
.mc-map-fallback code{font-family:var(--f-mono);font-size:11.5px;}
```

Delete `frontend/src/lib/mapTiles.ts` and `frontend/src/lib/mapTiles.test.ts`:

```bash
git rm frontend/src/lib/mapTiles.ts frontend/src/lib/mapTiles.test.ts
```

- [ ] **Step 5: Run the full frontend suite**

Run: `cd frontend && npm test && npm run lint`
Expected: all tests pass (MapWorkspace/App tests mock `./MapCanvas`, so only the new MapCanvas tests exercise the rewrite). Common failure: `import.meta.env` typing — if tsc complains, ensure `frontend/src/vite-env.d.ts` exists with `/// <reference types="vite/client" />`.

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src frontend/vite.config.ts
git commit -m "feat(map): MapCanvas on maplibre-gl over self-hosted vector tiles"
```

---

### Task 8: Remove Leaflet

**Files:**
- Modify: `frontend/package.json` (via npm)

- [ ] **Step 1: Uninstall**

```bash
cd frontend && npm uninstall leaflet react-leaflet @types/leaflet
```

- [ ] **Step 2: Verify nothing references it**

Run: `grep -ri "leaflet" frontend/src frontend/index.html; echo "exit=$?"`
Expected: `exit=1` (no matches).

- [ ] **Step 3: Full frontend gate**

Run: `cd frontend && npm test && npm run build`
Expected: tests pass; build succeeds. Note the main bundle size change in the commit message (maplibre-gl is larger than leaflet — expected, it replaces an external tile CDN).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json
git commit -m "build(frontend): drop leaflet/react-leaflet (replaced by maplibre-gl)"
```

---

### Task 9: Deploy wiring (compose volume, ps1 fetch step, DEPLOY.md)

**Files:**
- Modify: `docker-compose.yml` (api service)
- Modify: `scripts/start-waypoint.ps1` (after the pull block, before the Docker-engine section)
- Modify: `docs/DEPLOY.md`

- [ ] **Step 1: Mount the tiles dir into the api container**

In `docker-compose.yml`, add to the `api:` service (the image `COPY app ./app` bakes whatever existed at build time; the volume keeps the host artifact authoritative without rebuilds):

```yaml
    volumes:
      - ./app/data/tiles:/app/app/data/tiles:ro
```

If the api service already has a `volumes:` key, append the line to it.

- [ ] **Step 2: Fetch tiles in the deploy script**

In `scripts/start-waypoint.ps1`, after the `Push-Location $repo ... Pop-Location` pull block and before the `# 1. Docker engine` section:

```powershell
# 0.5 Self-hosted basemap tiles: fetch once if missing (kept out of git; ~100 MB).
#     A failure here is non-fatal — the app runs with a flat-background map fallback.
$tiles = Join-Path $repo 'app\data\tiles\seattle.pmtiles'
if (-not (Test-Path $tiles)) {
    Write-Host 'Basemap tiles missing; fetching (one-time, ~100 MB)...'
    python (Join-Path $repo 'scripts\fetch_tiles.py')
    if ($LASTEXITCODE -ne 0) { Write-Host 'WARNING: tile fetch failed; map will use the fallback background.' }
}
```

- [ ] **Step 3: Document in DEPLOY.md**

Add a short section (match the doc's existing heading style) after the environment-variable section:

```markdown
## Basemap tiles (self-hosted)

The map renders from a self-hosted Seattle vector-tile extract so no third-party tile
server ever sees where users look. `scripts/start-waypoint.ps1` fetches it automatically
on first run; to fetch or refresh manually:

    python scripts/fetch_tiles.py            # or: make fetch-tiles (Mac/dev)
    python scripts/fetch_tiles.py --force    # refresh to the latest Protomaps build

Artifacts (all gitignored): `app/data/tiles/seattle.pmtiles` (~100 MB, volume-mounted
into the api container read-only) and `frontend/public/basemaps-assets/` (fonts/sprites,
baked into the frontend build). If the file is missing the app still runs — the map shows
a flat background with a "run make fetch-tiles" notice.
```

- [ ] **Step 4: Validate compose syntax**

Run: `docker compose config --quiet && echo OK` (skip if Docker isn't running locally; then eyeball indentation against the neighboring `db:` service).
Expected: `OK` (or careful manual review).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml scripts/start-waypoint.ps1 docs/DEPLOY.md
git commit -m "chore(deploy): fetch + mount self-hosted basemap tiles"
```

---

### Task 10: Full gate + live verification

- [ ] **Step 1: Full verification gate**

Run: `make test-all`
Expected: pytest, ruff, frontend tests, and build all green.

- [ ] **Step 2: Live check — real tiles**

Start the backend (`make run`) and the frontend dev server, then verify in the browser/preview:
1. Basemap renders real Seattle geography (streets, water, labels) — light civic palette.
2. Pan/zoom is smooth; the Network tab shows range requests to `/tiles/seattle.pmtiles` and **no requests to cartocdn.com or any external host** (attribution links aside).
3. Place pins render with the same teardrop styles as before; clicking a pin selects it; analyzed places show the radius ring; address lookup still flies the map.
4. Attribution control shows OpenStreetMap/Protomaps.

- [ ] **Step 3: Live check — fallback path**

Temporarily rename the artifact: `mv app/data/tiles/seattle.pmtiles app/data/tiles/seattle.pmtiles.bak`, reload:
1. Map shows the flat civic background + "Basemap tiles unavailable" notice.
2. Pins/rings/analysis still work.

Restore: `mv app/data/tiles/seattle.pmtiles.bak app/data/tiles/seattle.pmtiles`.

- [ ] **Step 4: Fix anything found, re-run `make test-all`, commit fixes**

```bash
git add -A && git commit -m "fix(map): live-verification fixes for the maplibre foundation"
```

(Skip the commit if there was nothing to fix.)

---

## Self-review checklist (run after writing, before handoff)

- Spec coverage: engine swap ✓ (T7/T8), self-hosted PMTiles ✓ (T5/T6), range serving ✓ (T4), light+dark styles with pinned palette ✓ (T3), pins/rings/flyTo 1:1 ✓ (T7), fetch tooling + gitignore ✓ (T5), degradation ✓ (T3/T7/T10), Carto fallback flag ✓ (T3/T7), deploy wiring + DEPLOY.md ✓ (T9), OSM attribution ✓ (T3).
- Dark style ships and is tested (T3) but nothing toggles it until Slice 3 — intentional (YAGNI on the toggle, not on the style).
- Known judgment calls an implementer may hit: `Flavor` key names (T3 Step 4 covers it), `builds.json` listing shape (T6 Step 1 covers it), Starlette range behavior (T4 Step 4 covers it).

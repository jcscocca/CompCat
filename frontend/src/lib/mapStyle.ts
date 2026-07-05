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
    // v4 tracks the @protomaps/basemaps sprite schema version; keep in sync when bumping the dep.
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

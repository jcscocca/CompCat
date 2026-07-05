import { describe, expect, it } from "vitest";
import {
  buildMapStyle,
  CIVIC_MAP_COLORS,
  cartoRasterStyle,
  fallbackMapStyle,
  TILES_URL,
} from "./mapStyle";

// Privacy guard matcher: catches absolute (http/https), protocol-relative (//host),
// and non-http-scheme (ws://, wss://, ftp://) URLs in the serialized style.
const URL_PATTERN = /(?:[a-z+]+:)?\/\/[^"]+/g;

describe("buildMapStyle", () => {
  it("points the vector source at the self-hosted PMTiles file via the pmtiles protocol", () => {
    const style = buildMapStyle("light", "http://localhost:8000");
    const source = style.sources.protomaps as { type: string; url?: string };
    expect(source.type).toBe("vector");
    expect(source.url).toBe(`pmtiles://http://localhost:8000${TILES_URL}`);
  });

  it("self-hosts glyphs and sprites (no external hosts)", () => {
    const origin = "http://localhost:8000";
    const style = buildMapStyle("dark", origin);
    expect(style.glyphs).toBe(`${origin}/basemaps-assets/fonts/{fontstack}/{range}.pbf`);
    expect(String(style.sprite)).toBe(`${origin}/basemaps-assets/sprites/v4/dark`);
    // Only these exact external hrefs are permitted (attribution links). A
    // substring test would wrongly pass api.protomaps.com or ?ref=protomaps.com.
    const ATTRIBUTION_ALLOWLIST = new Set([
      "https://www.openstreetmap.org/copyright",
      "https://protomaps.com",
    ]);
    const urls = JSON.stringify(style).match(URL_PATTERN) ?? [];
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      // pmtiles:// wraps a same-origin http URL; unwrap before the origin check.
      const target = url.replace(/^pmtiles:\/\//, "");
      // Trailing "\" is the JSON-escape artifact of the href's closing quote.
      const href = url.replace(/\\+$/, "");
      const allowed = target.startsWith(`${origin}/`) || ATTRIBUTION_ALLOWLIST.has(href);
      expect(allowed, `unexpected external URL: ${url}`).toBe(true);
    }
  });

  it("catches protocol-relative and non-http-scheme URLs (guard self-test)", () => {
    const fixture = '{"sprite":"//x.example/sprite","socket":"wss://x.example/live"}';
    const matches = fixture.match(URL_PATTERN) ?? [];
    expect(matches).toContain("//x.example/sprite");
    expect(matches).toContain("wss://x.example/live");
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

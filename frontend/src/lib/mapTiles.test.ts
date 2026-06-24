import { describe, expect, it } from "vitest";

import { defaultTileConfig } from "./mapTiles";

describe("defaultTileConfig", () => {
  it("uses the muted Carto Positron basemap with attribution", () => {
    expect(defaultTileConfig.url).toContain("basemaps.cartocdn.com/light_all");
    expect(defaultTileConfig.attribution).toContain("OpenStreetMap");
    expect(defaultTileConfig.attribution).toContain("CARTO");
    expect(defaultTileConfig.maxZoom).toBeGreaterThanOrEqual(18);
    expect(defaultTileConfig.provider).toBe("carto-positron");
  });
});

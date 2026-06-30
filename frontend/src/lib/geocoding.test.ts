import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackendProvider, SEATTLE_BBOX, withinSeattleBbox } from "./geocoding";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createBackendProvider", () => {
  it("queries the backend endpoint and returns its GeocodeResult rows", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createBackendProvider();
    const results = await provider.search("pike place");

    expect(results).toEqual([
      { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
    ]);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("/dashboard/geocode");
    expect(calledUrl).toContain("q=pike%20place");
  });

  it("returns an empty list for a blank query without calling fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const provider = createBackendProvider();

    expect(await provider.search("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the backend responds with an error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 502 }));
    const provider = createBackendProvider();

    await expect(provider.search("x")).rejects.toThrow("Search failed with status 502");
  });

  it("filters out results outside the Seattle bbox", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          // inside bbox
          { label: "Capitol Hill, Seattle", latitude: 47.625, longitude: -122.322, source: "nominatim" },
          // outside bbox — Times Square, NYC
          { label: "Times Square, New York", latitude: 40.758, longitude: -73.985, source: "nominatim" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createBackendProvider();
    const results = await provider.search("capitol hill");

    expect(results).toHaveLength(1);
    expect(results[0].label).toBe("Capitol Hill, Seattle");
  });
});

describe("SEATTLE_BBOX", () => {
  it("exports the expected bounding box constants", () => {
    expect(SEATTLE_BBOX).toEqual({ west: -122.55, north: 47.78, east: -122.10, south: 47.43 });
  });
});

describe("withinSeattleBbox", () => {
  it("returns true for a result clearly inside the bbox", () => {
    expect(withinSeattleBbox({ label: "Pike Place", latitude: 47.6097, longitude: -122.3331, source: "nominatim" })).toBe(true);
  });

  it("returns false for a result outside the bbox (NYC)", () => {
    expect(withinSeattleBbox({ label: "Times Square", latitude: 40.758, longitude: -73.985, source: "nominatim" })).toBe(false);
  });

  it("returns false for a result with latitude above north bound", () => {
    expect(withinSeattleBbox({ label: "Too Far North", latitude: 47.90, longitude: -122.33, source: "nominatim" })).toBe(false);
  });

  it("returns false for a result with longitude west of west bound", () => {
    expect(withinSeattleBbox({ label: "Too Far West", latitude: 47.60, longitude: -122.60, source: "nominatim" })).toBe(false);
  });
});

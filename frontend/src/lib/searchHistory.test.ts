// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { addRecentPlace, clearRecentPlaces, loadRecentPlaces } from "./searchHistory";
import type { GeocodeResult } from "../types";

const pike: GeocodeResult = { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" };
const capitol: GeocodeResult = { label: "Capitol Hill, Seattle", latitude: 47.6253, longitude: -122.3222, source: "nominatim" };
const fremont: GeocodeResult = { label: "Fremont, Seattle", latitude: 47.6518, longitude: -122.3500, source: "nominatim" };
const belltown: GeocodeResult = { label: "Belltown, Seattle", latitude: 47.6146, longitude: -122.3423, source: "nominatim" };
const slu: GeocodeResult = { label: "South Lake Union, Seattle", latitude: 47.6232, longitude: -122.3360, source: "nominatim" };
const pioneer: GeocodeResult = { label: "Pioneer Square, Seattle", latitude: 47.6005, longitude: -122.3321, source: "nominatim" };

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("searchHistory", () => {
  it("returns an empty list when nothing is stored", () => {
    expect(loadRecentPlaces()).toEqual([]);
  });

  it("purges legacy persistent history without migrating it", () => {
    localStorage.setItem("compcat.search.recent", JSON.stringify([pike]));

    expect(loadRecentPlaces()).toEqual([]);
    expect(localStorage.getItem("compcat.search.recent")).toBeNull();
    expect(sessionStorage.getItem("compcat.search.recent")).toBeNull();
  });

  it("loads the current tab history while purging any legacy copy", () => {
    sessionStorage.setItem("compcat.search.recent", JSON.stringify([pike]));
    localStorage.setItem("compcat.search.recent", JSON.stringify([capitol]));

    expect(loadRecentPlaces()).toEqual([pike]);
    expect(localStorage.getItem("compcat.search.recent")).toBeNull();
  });

  it("prepends a new place and returns it first", () => {
    addRecentPlace(pike);
    const result = addRecentPlace(capitol);
    expect(result[0]).toEqual(capitol);
    expect(result[1]).toEqual(pike);
  });

  it("caps the list at 5 entries, dropping the oldest", () => {
    addRecentPlace(pike);
    addRecentPlace(capitol);
    addRecentPlace(fremont);
    addRecentPlace(belltown);
    addRecentPlace(slu);
    const result = addRecentPlace(pioneer);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual(pioneer);
    expect(result.find((r) => r.label === pike.label)).toBeUndefined();
  });

  it("deduplicates by label+coords, keeping the most-recent position", () => {
    addRecentPlace(pike);
    addRecentPlace(capitol);
    const result = addRecentPlace(pike);
    // pike should now be first, and appear only once
    expect(result[0]).toEqual(pike);
    expect(result.filter((r) => r.label === pike.label)).toHaveLength(1);
  });

  it("preserves order: most-recent first", () => {
    addRecentPlace(pike);
    addRecentPlace(capitol);
    addRecentPlace(fremont);
    const loaded = loadRecentPlaces();
    expect(loaded[0].label).toBe(fremont.label);
    expect(loaded[1].label).toBe(capitol.label);
    expect(loaded[2].label).toBe(pike.label);
  });

  it("writes only to tab-scoped session storage", () => {
    addRecentPlace(pike);

    expect(JSON.parse(sessionStorage.getItem("compcat.search.recent") ?? "[]")).toEqual([pike]);
    expect(localStorage.getItem("compcat.search.recent")).toBeNull();
  });

  it("clears both tab-scoped history and a legacy persistent copy", () => {
    sessionStorage.setItem("compcat.search.recent", JSON.stringify([pike]));
    localStorage.setItem("compcat.search.recent", JSON.stringify([capitol]));

    clearRecentPlaces();

    expect(sessionStorage.getItem("compcat.search.recent")).toBeNull();
    expect(localStorage.getItem("compcat.search.recent")).toBeNull();
    expect(loadRecentPlaces()).toEqual([]);
  });

  it("returns an empty list when stored JSON is valid but not an array", () => {
    sessionStorage.setItem("compcat.search.recent", '{"x":1}');
    expect(loadRecentPlaces()).toEqual([]);
    // and a subsequent add does not throw on the bad shape
    const result = addRecentPlace(pike);
    expect(result).toEqual([pike]);
  });

  it("filters malformed, out-of-Seattle, and obsolete-schema rows element by element", () => {
    sessionStorage.setItem("compcat.search.recent", JSON.stringify([
      pike,
      { label: "", latitude: 47.61, longitude: -122.33, source: "nominatim" },
      { label: "Portland", latitude: 45.52, longitude: -122.68, source: "nominatim" },
      { label: "Bad number", latitude: null, longitude: -122.33, source: "nominatim" },
      { oldLabel: "old schema", lat: 47.61, lon: -122.33 },
    ]));

    expect(loadRecentPlaces()).toEqual([pike]);
    expect(() => addRecentPlace(capitol)).not.toThrow();
    expect(loadRecentPlaces()).toEqual([capitol, pike]);
  });

  it("falls back to an empty list when sessionStorage throws on read", () => {
    vi.spyOn(sessionStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadRecentPlaces()).toEqual([]);
  });

  it("silently ignores a write failure and returns the in-memory list", () => {
    vi.spyOn(sessionStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });
    const result = addRecentPlace(pike);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(pike);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

import { createBackendProvider } from "./geocoding";

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
});

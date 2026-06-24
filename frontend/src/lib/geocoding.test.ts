import { afterEach, describe, expect, it, vi } from "vitest";

import { createNominatimProvider } from "./geocoding";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createNominatimProvider", () => {
  it("maps search rows to GeocodeResult and queries the endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify([
          { display_name: "Pike Place Market, Seattle", lat: "47.6097", lon: "-122.3331" },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const provider = createNominatimProvider();
    const results = await provider.search("pike place");

    expect(results).toEqual([
      { label: "Pike Place Market, Seattle", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
    ]);
    const calledUrl = String(fetchMock.mock.calls[0][0]);
    expect(calledUrl).toContain("format=jsonv2");
    expect(calledUrl).toContain("q=pike%20place");
  });

  it("returns an empty list for a blank query without calling fetch", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const provider = createNominatimProvider();

    expect(await provider.search("   ")).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws when the endpoint responds with an error status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const provider = createNominatimProvider();

    await expect(provider.search("x")).rejects.toThrow("Search failed with status 500");
  });
});

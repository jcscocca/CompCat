import { afterEach, describe, expect, it, vi } from "vitest";

import { createPlace, deletePlace, getDashboardSummary } from "./client";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("api client", () => {
  it("creates places with JSON and cookie credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "place-1", display_label: "Library" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await createPlace({
      display_label: "Library",
      latitude: 47.621,
      longitude: -122.321,
      visit_count: 4,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/places",
      expect.objectContaining({
        body: JSON.stringify({
          display_label: "Library",
          latitude: 47.621,
          longitude: -122.321,
          visit_count: 4,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("returns undefined for delete responses without content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deletePlace("place-1")).resolves.toBeUndefined();
  });

  it("throws response text when a request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("No session", { status: 401 }));

    await expect(getDashboardSummary()).rejects.toThrow("No session");
  });

  it("throws a status fallback when a failed request has no response text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    await expect(getDashboardSummary()).rejects.toThrow("Request failed with status 500");
  });
});

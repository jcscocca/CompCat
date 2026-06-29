// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useAddressSearch } from "./useAddressSearch";

describe("useAddressSearch", () => {
  it("runs a trimmed search and exposes the results", async () => {
    const search = vi.fn().mockResolvedValue([
      { label: "Pike Place", latitude: 47.61, longitude: -122.34, source: "nominatim" },
    ]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("  pike  "));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(search).toHaveBeenCalledWith("pike");
    expect(result.current.status).toBe("done");
    expect(result.current.results).toHaveLength(1);
  });

  it("does not call search for a blank query and stays idle", async () => {
    const search = vi.fn().mockResolvedValue([]);
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("   "));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(search).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("reports an error status and clears results when the search rejects", async () => {
    const search = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useAddressSearch(search));

    act(() => result.current.setQuery("x"));
    await act(async () => {
      await result.current.runSearch();
    });

    expect(result.current.status).toBe("error");
    expect(result.current.results).toEqual([]);
  });
});

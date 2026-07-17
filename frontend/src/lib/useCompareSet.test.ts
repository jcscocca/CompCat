// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAddressList, keyOf, MAX_ADDRESSES, entriesFromPlaces } from "./useCompareSet";
import type { Place } from "../types";

const place = (id: string, label: string, lat: number, lng: number): Place => ({
  id, display_label: label, latitude: lat, longitude: lng, visit_count: 1,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
});
const home = place("p1", "Home", 47.61, -122.33);
const work = place("p2", "Work", 47.62, -122.34);

const persistSpy = vi.fn();

beforeEach(() => {
  localStorage.clear();
  persistSpy.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe("useAddressList", () => {
  it("seeds once from the provided saved places and reports their ids", () => {
    const { result } = renderHook(() => useAddressList({ seed: [home, work], onSavedIdsChange: persistSpy }));
    expect(result.current.entries).toHaveLength(2);
    expect(result.current.entries[0]).toMatchObject({ label: "Home", savedPlaceId: "p1" });
    expect(result.current.savedIds()).toEqual(["p1", "p2"]);
  });

  it("re-seeds when the seed changes until the first manual edit, then stays put", () => {
    const { result, rerender } = renderHook(({ seed }) => useAddressList({ seed, onSavedIdsChange: persistSpy }), {
      initialProps: { seed: [home] },
    });
    rerender({ seed: [home, work] });
    expect(result.current.entries).toHaveLength(2);
    act(() => result.current.add({ latitude: 47.7, longitude: -122.3, label: "Adhoc" }));
    rerender({ seed: [home] });
    expect(result.current.entries).toHaveLength(3);
  });

  it("reports edited=false while seeded and true after the first mutation", () => {
    const { result, rerender } = renderHook(({ seed }) => useAddressList({ seed, onSavedIdsChange: persistSpy }), {
      initialProps: { seed: [home] },
    });
    expect(result.current.edited).toBe(false);
    rerender({ seed: [home, work] });
    expect(result.current.edited).toBe(false);
    act(() => result.current.add({ latitude: 47.7, longitude: -122.3, label: "Adhoc" }));
    expect(result.current.edited).toBe(true);
  });

  it("add() normalizes coords to 3 decimals and dedupes by keyOf, capped at MAX", () => {
    const { result } = renderHook(() => useAddressList({ seed: [], onSavedIdsChange: persistSpy }));
    act(() => result.current.add({ latitude: 47.6123456, longitude: -122.334567, label: "A" }));
    act(() => result.current.add({ latitude: 47.6123999, longitude: -122.334999, label: "A dup" }));
    expect(result.current.entries).toHaveLength(2 - 1);
    expect(result.current.entries[0].latitude).toBe(47.612);
    for (let i = 0; i < MAX_ADDRESSES + 3; i += 1) {
      act(() => result.current.add({ latitude: 47.0 + i * 0.01, longitude: -122.0, label: `P${i}` }));
    }
    expect(result.current.entries.length).toBeLessThanOrEqual(MAX_ADDRESSES);
  });

  it("toggleSaved adds a saved place as an entry and removes it on second call", () => {
    const { result } = renderHook(() => useAddressList({ seed: [], onSavedIdsChange: persistSpy }));
    act(() => result.current.toggleSaved(home));
    expect(result.current.entries[0]).toMatchObject({ savedPlaceId: "p1", label: "Home" });
    act(() => result.current.toggleSaved(home));
    expect(result.current.entries).toHaveLength(0);
  });

  it("toggleSaved upgrades a colliding ad-hoc entry in place instead of dropping the stamp", () => {
    const { result } = renderHook(() => useAddressList({ seed: [], onSavedIdsChange: persistSpy }));
    act(() => result.current.add({ latitude: 47.61, longitude: -122.33, label: "Typed address" }));
    act(() => result.current.toggleSaved(home));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0]).toMatchObject({ savedPlaceId: "p1", label: "Home" });
    expect(result.current.savedIds()).toEqual(["p1"]);
    act(() => result.current.toggleSaved(home));
    expect(result.current.entries).toHaveLength(0);
  });

  it("replaceAll swaps the whole list and counts as an edit", () => {
    const { result, rerender } = renderHook(({ seed }) => useAddressList({ seed, onSavedIdsChange: persistSpy }), {
      initialProps: { seed: [home] },
    });
    act(() => result.current.replaceAll([{ latitude: 47.65, longitude: -122.3, label: "Shared A" }]));
    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].label).toBe("Shared A");
    rerender({ seed: [home, work] });
    expect(result.current.entries).toHaveLength(1);
  });

  it("notifies onSavedIdsChange with the saved ids present after each change (post-seed)", () => {
    const { result } = renderHook(() => useAddressList({ seed: [home], onSavedIdsChange: persistSpy }));
    act(() => result.current.toggleSaved(work));
    expect(persistSpy).toHaveBeenLastCalledWith(["p1", "p2"]);
    act(() => result.current.removeAt(0));
    expect(persistSpy).toHaveBeenLastCalledWith(["p2"]);
  });

  it("seeding never notifies onSavedIdsChange; the first edit does", () => {
    const { result } = renderHook(() => useAddressList({ seed: [home, work], onSavedIdsChange: persistSpy }));
    expect(persistSpy).not.toHaveBeenCalled();
    act(() => result.current.add({ latitude: 47.7, longitude: -122.3, label: "Adhoc" }));
    expect(persistSpy).toHaveBeenCalledWith(["p1", "p2"]);
  });

  it("markSaved upgrades a matching ad-hoc entry in place (opt-in Save flow)", () => {
    const { result } = renderHook(() => useAddressList({ seed: [], onSavedIdsChange: persistSpy }));
    act(() => result.current.add({ latitude: 47.61, longitude: -122.33, label: "Home" }));
    act(() => result.current.markSaved(keyOf(result.current.entries[0]), "p1"));
    expect(result.current.entries[0].savedPlaceId).toBe("p1");
  });

  it("entriesFromPlaces drops null coords and caps", () => {
    const noCoords: Place = { ...home, id: "p9", latitude: null, longitude: null };
    expect(entriesFromPlaces([home, noCoords, work])).toHaveLength(2);
  });
});

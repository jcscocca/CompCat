// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCompare } from "./useCompare";

vi.mock("../api/client", () => ({
  analyzePlaces: vi.fn().mockResolvedValue({ summary_count: 1 }),
  comparePlaces: vi.fn().mockResolvedValue({ id: "cmp" } as unknown),
  getIncidentDetails: vi.fn().mockResolvedValue({ incidents: [], total_count: 0, returned_count: 0, radius_m: 250 } as unknown),
  getNeighborhoodAnalysis: vi.fn().mockResolvedValue({ places: [] } as unknown),
}));
import { analyzePlaces, comparePlaces, getIncidentDetails, getNeighborhoodAnalysis } from "../api/client";

const analysis = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 250, offenseCategory: "", layer: "reported" as const };
const A = { latitude: 47.61, longitude: -122.34, label: "A" };
const B = { latitude: 47.62, longitude: -122.33, label: "B", savedPlaceId: "p2" };

function mock(fn: unknown) {
  return fn as ReturnType<typeof vi.fn>;
}

afterEach(() => vi.clearAllMocks());

describe("useCompare unified run", () => {
  it("N=1: fetches neighborhood + incidents with points, skips compare", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(expect.objectContaining({ points: [expect.objectContaining({ label: "A" })], radii_m: [250] }));
    expect(getIncidentDetails).toHaveBeenCalledWith(expect.objectContaining({ radii_m: [250] }));
    expect(comparePlaces).not.toHaveBeenCalled();
    expect(result.current.neighborhood).toEqual({ places: [] });
    expect(result.current.incidents).toEqual(expect.objectContaining({ total_count: 0 }));
    expect(result.current.comparison).toBeNull();
    expect(result.current.runPoints).toEqual([expect.objectContaining({ label: "A" })]);
  });

  it("N=2: adds the compare call; payloads share points, radius fields differ per endpoint", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    expect(comparePlaces).toHaveBeenCalledWith(expect.objectContaining({ radius_m: 250 }));
    expect(mock(comparePlaces).mock.calls[0][0].radii_m).toBeUndefined();
    expect(mock(getNeighborhoodAnalysis).mock.calls[0][0].radius_m).toBeUndefined();
    expect(result.current.comparison).toEqual({ id: "cmp" });
  });

  it("refreshes saved-place summaries via place_ids when saved entries exist", async () => {
    const onSummariesRefreshed = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn(), onSummariesRefreshed }));
    await act(async () => { await result.current.run(); });
    expect(analyzePlaces).toHaveBeenCalledWith(expect.objectContaining({ place_ids: ["p2"] }));
    expect(mock(analyzePlaces).mock.calls[0][0].points).toBeUndefined();
    expect(onSummariesRefreshed).toHaveBeenCalled();
  });

  it("skips the place_ids refresh when the list is all ad-hoc", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    expect(analyzePlaces).not.toHaveBeenCalled();
  });

  it("does not fire onSummariesRefreshed when the list is all ad-hoc", async () => {
    const onSummariesRefreshed = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A], analysis, setError: vi.fn(), onSummariesRefreshed }));
    await act(async () => { await result.current.run(); });
    expect(onSummariesRefreshed).not.toHaveBeenCalled();
  });

  it("does not fire onSummariesRefreshed when the place_ids refresh rejects", async () => {
    mock(analyzePlaces).mockRejectedValueOnce(new Error("boom"));
    const onSummariesRefreshed = vi.fn();
    const setError = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError, onSummariesRefreshed }));
    await act(async () => { await result.current.run(); });
    expect(onSummariesRefreshed).not.toHaveBeenCalled();
    expect(setError).not.toHaveBeenCalledWith("Unable to run this analysis. Try again.");
  });

  it("caps >120-char labels in the POSTed points", async () => {
    const longLabel = "A".repeat(140);
    const { result } = renderHook(() => useCompare({ entries: [{ ...A, label: longLabel }], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    expect(mock(getNeighborhoodAnalysis).mock.calls[0][0].points[0].label).toHaveLength(120);
  });

  it("neighborhood failure alone degrades without an error; incidents survive", async () => {
    mock(getNeighborhoodAnalysis).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError }));
    await act(async () => { await result.current.run(); });
    expect(result.current.neighborhood).toBeNull();
    expect(result.current.comparison).toEqual({ id: "cmp" });
    expect(result.current.incidents).not.toBeNull();
    expect(setError).not.toHaveBeenCalledWith("Unable to run this analysis. Try again.");
  });

  it("N≥2 compare failure sets the error and clears the comparison", async () => {
    mock(comparePlaces).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError }));
    await act(async () => { await result.current.run(); });
    expect(result.current.comparison).toBeNull();
    expect(setError).toHaveBeenCalledWith("Unable to run this analysis. Try again.");
  });

  it("N=1 neighborhood failure sets the error (it is the primary payload)", async () => {
    mock(getNeighborhoodAnalysis).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() => useCompare({ entries: [A], analysis, setError }));
    await act(async () => { await result.current.run(); });
    expect(setError).toHaveBeenCalledWith("Unable to run this analysis. Try again.");
  });

  it("invalidate clears every result slice including runPoints", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    act(() => { result.current.invalidate(); });
    expect(result.current.comparison).toBeNull();
    expect(result.current.neighborhood).toBeNull();
    expect(result.current.incidents).toBeNull();
    expect(result.current.runPoints).toBeNull();
  });

  it("applyAssistant(comparison) replaces the pane and clears the other slices", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    act(() => { result.current.applyAssistant({ comparison: { id: "c9" } as never }); });
    expect(result.current.comparison).toEqual({ id: "c9" });
    expect(result.current.neighborhood).toBeNull();
    expect(result.current.runPoints).toBeNull();
  });

  it("applyAssistant(neighborhood/incidents) replaces those panes and clears the comparison", async () => {
    const { result } = renderHook(() => useCompare({ entries: [A, B], analysis, setError: vi.fn() }));
    await act(async () => { await result.current.run(); });
    act(() => { result.current.applyAssistant({ neighborhood: { places: [] } as never, incidents: null }); });
    expect(result.current.neighborhood).toEqual({ places: [] });
    expect(result.current.comparison).toBeNull();
  });

  it("a stale run cannot overwrite results after invalidate", async () => {
    let release: (v: unknown) => void = () => {};
    mock(getNeighborhoodAnalysis).mockImplementationOnce(() => new Promise((res) => { release = res; }));
    const { result } = renderHook(() => useCompare({ entries: [A], analysis, setError: vi.fn() }));
    let pending: Promise<void>;
    act(() => { pending = result.current.run(); });
    act(() => { result.current.invalidate(); });
    await act(async () => { release({ places: ["stale"] }); await pending!; });
    expect(result.current.neighborhood).toBeNull();
  });
});

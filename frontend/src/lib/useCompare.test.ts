// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCompare } from "./useCompare";

vi.mock("../api/client", () => ({
  comparePlaces: vi.fn().mockResolvedValue({} as unknown),
  getNeighborhoodAnalysis: vi.fn().mockResolvedValue({} as unknown),
}));
import { comparePlaces, getNeighborhoodAnalysis } from "../api/client";

const analysis = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 250, offenseCategory: "", layer: "reported" as const };
const points = [
  { latitude: 47.61, longitude: -122.34, label: "A" },
  { latitude: 47.62, longitude: -122.33, label: "B" },
];

afterEach(() => vi.clearAllMocks());

describe("useCompare shared-view points", () => {
  it("sends points (not place_ids) when a points override is provided", async () => {
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    expect(comparePlaces).toHaveBeenCalledWith(expect.objectContaining({ points }));
    expect((comparePlaces as ReturnType<typeof vi.fn>).mock.calls[0][0].place_ids).toBeUndefined();
  });

  it("caps a >120-char point label at 120 chars in the POSTed body", async () => {
    const longLabel = "A".repeat(140);
    const longPoints = [
      { latitude: 47.61, longitude: -122.34, label: longLabel },
      { latitude: 47.62, longitude: -122.33, label: "B" },
    ];
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points: longPoints }));
    await act(async () => { await result.current.runCompare(); });
    const sentPoints = (comparePlaces as ReturnType<typeof vi.fn>).mock.calls[0][0].points;
    expect(sentPoints[0].label).toBe(longLabel.slice(0, 120));
    expect(sentPoints[0].label.length).toBe(120);
  });
});

describe("useCompare neighborhood context", () => {
  it("fetches the neighborhood analysis in parallel with the same points and radii_m", async () => {
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(expect.objectContaining({ points, radii_m: [250] }));
    expect((getNeighborhoodAnalysis as ReturnType<typeof vi.fn>).mock.calls[0][0].radius_m).toBeUndefined();
    expect(result.current.neighborhood).toEqual({});
  });

  it("keeps the comparison and clears neighborhood when only the neighborhood call fails", async () => {
    (getNeighborhoodAnalysis as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError, points }));
    await act(async () => { await result.current.runCompare(); });
    expect(result.current.comparison).toEqual({});
    expect(result.current.neighborhood).toBeNull();
    expect(setError).toHaveBeenCalledWith("");
    expect(setError).not.toHaveBeenCalledWith("Unable to compare places. Try again.");
  });

  it("errors and keeps no comparison when the compare call fails, even if neighborhood succeeds", async () => {
    (comparePlaces as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("boom"));
    const setError = vi.fn();
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError, points }));
    await act(async () => { await result.current.runCompare(); });
    expect(result.current.comparison).toBeNull();
    expect(setError).toHaveBeenCalledWith("Unable to compare places. Try again.");
  });

  it("invalidate clears both comparison and neighborhood", async () => {
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    act(() => { result.current.invalidate(); });
    expect(result.current.comparison).toBeNull();
    expect(result.current.neighborhood).toBeNull();
  });

  it("applyAssistant sets the comparison and clears any stale neighborhood", async () => {
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    act(() => { result.current.applyAssistant({ id: "c9" } as never); });
    expect(result.current.comparison).toEqual({ id: "c9" });
    expect(result.current.neighborhood).toBeNull();
  });
});

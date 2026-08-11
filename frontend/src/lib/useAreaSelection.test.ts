// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", async (loadOriginal) => {
  const actual = await loadOriginal<typeof import("../api/client")>();
  return {
    ...actual,
    getAreaSelectionSummary: vi.fn(),
    getAreaSelectionRecords: vi.fn(),
    exportAreaSelectionCsv: vi.fn(),
  };
});
vi.mock("./reportExport", () => ({ downloadBlob: vi.fn() }));

import { exportAreaSelectionCsv, getAreaSelectionRecords, getAreaSelectionSummary } from "../api/client";
import type { AnalysisSettings, AreaPolygonGeometry } from "../types";
import { downloadBlob } from "./reportExport";
import { useAreaSelection } from "./useAreaSelection";

const geometry: AreaPolygonGeometry = {
  type: "Polygon",
  coordinates: [[[-122.35, 47.60], [-122.32, 47.60], [-122.32, 47.63], [-122.35, 47.60]]],
};
const analysis: AnalysisSettings = { startDate: "2025-01-01", endDate: "2025-12-31", radiusM: 250, offenseCategory: "", layer: "reported" };
const summary = {
  selection_id: "s1", record_count: 2, location_count: 1,
  counting_basis: "records with mappable coordinates inside the selected area",
  type_mix: [], type_counts: {}, temporal: { hour_counts: Array(24).fill(0), dow_counts: Array(7).fill(0), hour_by_dow: Array.from({ length: 7 }, () => Array(24).fill(0)), total_with_time: 0, without_time: 2 },
  highlight_mode: "locations" as const,
  highlight_points: [{ id: "p1", latitude: 47.61, longitude: -122.33, record_count: 2, location_count: 1 }],
  highlight_location_count: 1,
};

describe("useAreaSelection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAreaSelectionSummary).mockResolvedValue(summary);
    vi.mocked(getAreaSelectionRecords).mockResolvedValue({ selection_id: "s1", records: [], returned_count: 0, page_size: 50, next_cursor: "cursor-2" });
    vi.mocked(exportAreaSelectionCsv).mockResolvedValue(new Blob(["x"]));
  });

  it("loads a complete summary, records page, and selected-location GeoJSON", async () => {
    const { result } = renderHook(() => useAreaSelection({ geometry, analysis, enabled: true }));
    await waitFor(() => expect(result.current.summary?.record_count).toBe(2));
    await waitFor(() => expect(result.current.records?.next_cursor).toBe("cursor-2"));
    expect(result.current.highlights.features[0].properties.record_count).toBe(2);
    expect(getAreaSelectionSummary).toHaveBeenCalledWith(expect.objectContaining({ geometry, layer: "reported", selected_types: [], selected_hours: [], selected_days: [] }), expect.any(AbortSignal));
  });

  it("uses cursor pagination and resets pages when page size changes", async () => {
    const { result } = renderHook(() => useAreaSelection({ geometry, analysis, enabled: true }));
    await waitFor(() => expect(result.current.canNext).toBe(true));
    act(() => result.current.nextPage());
    await waitFor(() => expect(result.current.pageNumber).toBe(2));
    expect(getAreaSelectionRecords).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "cursor-2" }), expect.any(AbortSignal));
    act(() => result.current.setPageSize(25));
    expect(result.current.pageNumber).toBe(1);
  });

  it("clears stale highlights while a changed selection is loading", async () => {
    let resolveChanged: ((value: typeof summary) => void) | undefined;
    vi.mocked(getAreaSelectionSummary)
      .mockResolvedValueOnce(summary)
      .mockReturnValueOnce(new Promise((resolve) => { resolveChanged = resolve; }));
    const changedGeometry: AreaPolygonGeometry = {
      type: "Polygon",
      coordinates: [[[-122.34, 47.61], [-122.31, 47.61], [-122.31, 47.64], [-122.34, 47.61]]],
    };
    const { result, rerender } = renderHook(
      ({ selectedGeometry }) => useAreaSelection({ geometry: selectedGeometry, analysis, enabled: true }),
      { initialProps: { selectedGeometry: geometry } },
    );
    await waitFor(() => expect(result.current.highlights.features).toHaveLength(1));

    rerender({ selectedGeometry: changedGeometry });
    await waitFor(() => expect(result.current.summaryLoading).toBe(true));
    expect(result.current.highlights.features).toHaveLength(0);

    await act(async () => resolveChanged?.({ ...summary, selection_id: "s2" }));
  });

  it("refreshes the summary, records, and highlights when the analysis dates change", async () => {
    const shortWindow = { ...summary, selection_id: "short", record_count: 13 };
    const fullWindow = {
      ...summary,
      selection_id: "full",
      record_count: 49,
      highlight_points: [{ ...summary.highlight_points[0], record_count: 49 }],
    };
    vi.mocked(getAreaSelectionSummary).mockImplementation(async (payload) => (
      payload.analysis_start_date === "2025-01-01" ? fullWindow : shortWindow
    ));
    const shortAnalysis = { ...analysis, startDate: "2025-07-29" };
    const { result, rerender } = renderHook(
      ({ activeAnalysis }) => useAreaSelection({ geometry, analysis: activeAnalysis, enabled: true }),
      { initialProps: { activeAnalysis: shortAnalysis } },
    );
    await waitFor(() => expect(result.current.summary?.record_count).toBe(13));

    rerender({ activeAnalysis: analysis });
    await waitFor(() => expect(result.current.summary?.record_count).toBe(49));
    expect(getAreaSelectionSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({
        analysis_start_date: "2025-01-01",
        analysis_end_date: "2025-12-31",
      }),
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(getAreaSelectionRecords).toHaveBeenLastCalledWith(
      expect.objectContaining({
        analysis_start_date: "2025-01-01",
        analysis_end_date: "2025-12-31",
      }),
      expect.any(AbortSignal),
    ));
    expect(result.current.highlights.features[0].properties.record_count).toBe(49);
  });

  it("shares linked filters across summary, records, highlights, and CSV export", async () => {
    const filtered = {
      ...summary,
      selection_id: "filtered",
      record_count: 1,
      highlight_points: [{ ...summary.highlight_points[0], record_count: 1 }],
    };
    vi.mocked(getAreaSelectionSummary)
      .mockResolvedValueOnce(summary)
      .mockResolvedValue(filtered);
    const { result } = renderHook(() => useAreaSelection({ geometry, analysis, enabled: true }));
    await waitFor(() => expect(result.current.baseSummary?.record_count).toBe(2));

    act(() => {
      result.current.toggleType("THEFT");
      result.current.toggleHour(12);
      result.current.toggleDay(1);
    });
    await waitFor(() => expect(result.current.summary?.selection_id).toBe("filtered"));

    const expectedFilters = {
      selected_types: ["THEFT"],
      selected_hours: [12],
      selected_days: [1],
    };
    expect(getAreaSelectionSummary).toHaveBeenLastCalledWith(
      expect.objectContaining(expectedFilters),
      expect.any(AbortSignal),
    );
    await waitFor(() => expect(getAreaSelectionRecords).toHaveBeenLastCalledWith(
      expect.objectContaining(expectedFilters),
      expect.any(AbortSignal),
    ));
    expect(result.current.baseSummary?.record_count).toBe(2);
    expect(result.current.highlights.features[0].properties.record_count).toBe(1);

    await act(async () => result.current.downloadCsv());
    expect(exportAreaSelectionCsv).toHaveBeenLastCalledWith(expect.objectContaining(expectedFilters));
    expect(downloadBlob).toHaveBeenCalledTimes(1);

    act(() => result.current.clearFilters());
    await waitFor(() => expect(result.current.activeFilterCount).toBe(0));
    expect(getAreaSelectionSummary).toHaveBeenLastCalledWith(
      expect.objectContaining({ selected_types: [], selected_hours: [], selected_days: [] }),
      expect.any(AbortSignal),
    );
  });
});

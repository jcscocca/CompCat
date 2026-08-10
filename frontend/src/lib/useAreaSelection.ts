import { useEffect, useMemo, useRef, useState } from "react";

import {
  exportAreaSelectionCsv,
  friendlyMessageOr,
  getAreaSelectionRecords,
  getAreaSelectionSummary,
  type AreaSelectionPayload,
} from "../api/client";
import type {
  AnalysisSettings,
  AreaPolygonGeometry,
  AreaSelectionFilters,
  AreaSelectionRecordsResponse,
  AreaSelectionSummary,
} from "../types";
import { downloadBlob } from "./reportExport";
import type { IncidentFeatureCollection } from "./useIncidentPoints";

const EMPTY_HIGHLIGHTS: IncidentFeatureCollection = { type: "FeatureCollection", features: [] };
const emptyFilters = (): AreaSelectionFilters => ({
  selectedTypes: [],
  selectedHours: [],
  selectedDays: [],
});

function highlightGeoJson(summary: AreaSelectionSummary | null): IncidentFeatureCollection {
  if (!summary) return EMPTY_HIGHLIGHTS;
  return {
    type: "FeatureCollection",
    features: summary.highlight_points.map((point) => ({
      type: "Feature",
      properties: {
        id: point.id,
        offense_category: null,
        offense_subcategory: null,
        occurred_at: null,
        block_address: null,
        record_count: point.record_count,
        location_count: point.location_count,
      },
      geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
    })),
  };
}

function payloadFor(geometry: AreaPolygonGeometry, analysis: AnalysisSettings): AreaSelectionPayload {
  return {
    geometry,
    analysis_start_date: analysis.startDate,
    analysis_end_date: analysis.endDate,
    offense_category: analysis.offenseCategory || null,
    layer: analysis.layer,
  };
}

export function useAreaSelection({
  geometry,
  analysis,
  enabled,
}: {
  geometry: AreaPolygonGeometry | null;
  analysis: AnalysisSettings;
  enabled: boolean;
}) {
  const [summary, setSummary] = useState<AreaSelectionSummary | null>(null);
  const [baseSummary, setBaseSummary] = useState<AreaSelectionSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [records, setRecords] = useState<AreaSelectionRecordsResponse | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageSize, setPageSizeState] = useState(50);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [filters, setFilters] = useState<AreaSelectionFilters>(emptyFilters);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const recordsAbortRef = useRef<AbortController | null>(null);
  const baseScopeKey = JSON.stringify([
    geometry,
    analysis.startDate,
    analysis.endDate,
    analysis.offenseCategory,
    analysis.layer,
    enabled,
  ]);
  const basePayload = useMemo(
    () => geometry ? payloadFor(geometry, analysis) : null,
    // baseScopeKey captures semantic equality when callers rebuild an equivalent object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseScopeKey],
  );
  const filterKey = JSON.stringify(filters);
  const payload = useMemo(
    () => basePayload ? {
      ...basePayload,
      selected_types: filters.selectedTypes,
      selected_hours: filters.selectedHours,
      selected_days: filters.selectedDays,
    } : null,
    // filterKey captures array contents while preserving stable request identities.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [basePayload, filterKey],
  );
  const hasActiveFilters = filters.selectedTypes.length > 0
    || filters.selectedHours.length > 0
    || filters.selectedDays.length > 0;
  const cursor = cursorStack.at(-1) ?? null;

  useEffect(() => {
    setFilters(emptyFilters());
    setBaseSummary(null);
  }, [basePayload]);

  useEffect(() => {
    summaryAbortRef.current?.abort();
    setCursorStack([null]);
    setRecords(null);
    setError(null);
    if (!payload || !enabled) {
      setSummary(null);
      setSummaryLoading(false);
      return;
    }
    const controller = new AbortController();
    summaryAbortRef.current = controller;
    setSummary(null);
    setSummaryLoading(true);
    getAreaSelectionSummary(payload, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setSummary(value);
        if (!hasActiveFilters) setBaseSummary(value);
        setSummaryLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setSummary(null);
        setSummaryLoading(false);
        setError(friendlyMessageOr(cause, "Area data could not load."));
      });
    return () => controller.abort();
  }, [payload, enabled, hasActiveFilters]);

  useEffect(() => {
    recordsAbortRef.current?.abort();
    if (!payload || !enabled) {
      setRecords(null);
      setRecordsLoading(false);
      return;
    }
    const controller = new AbortController();
    recordsAbortRef.current = controller;
    setRecordsLoading(true);
    getAreaSelectionRecords(
      { ...payload, page_size: pageSize, cursor },
      controller.signal,
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        setRecords(value);
        setRecordsLoading(false);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setRecords(null);
        setRecordsLoading(false);
        setError(friendlyMessageOr(cause, "Selected records could not load."));
      });
    return () => controller.abort();
  }, [payload, enabled, pageSize, cursor]);

  function nextPage() {
    if (!records?.next_cursor) return;
    setCursorStack((current) => [...current, records.next_cursor]);
  }

  function previousPage() {
    setCursorStack((current) => current.length > 1 ? current.slice(0, -1) : current);
  }

  function setPageSize(value: number) {
    setPageSizeState(value);
    setCursorStack([null]);
  }

  function toggleType(label: string) {
    setFilters((current) => ({
      ...current,
      selectedTypes: current.selectedTypes.includes(label)
        ? current.selectedTypes.filter((value) => value !== label)
        : [...current.selectedTypes, label],
    }));
  }

  function toggleHour(hour: number) {
    setFilters((current) => ({
      ...current,
      selectedHours: current.selectedHours.includes(hour)
        ? current.selectedHours.filter((value) => value !== hour)
        : [...current.selectedHours, hour].sort((a, b) => a - b),
    }));
  }

  function toggleDay(day: number) {
    setFilters((current) => ({
      ...current,
      selectedDays: current.selectedDays.includes(day)
        ? current.selectedDays.filter((value) => value !== day)
        : [...current.selectedDays, day].sort((a, b) => a - b),
    }));
  }

  function clearFilters() {
    setFilters(emptyFilters());
  }

  async function downloadCsv() {
    if (!payload) return;
    const blob = await exportAreaSelectionCsv(payload);
    downloadBlob(blob, `compcat-area-selection-${analysis.endDate}.csv`);
  }

  return {
    summary,
    baseSummary,
    summaryLoading,
    records,
    recordsLoading,
    error,
    highlights: highlightGeoJson(summary),
    pageSize,
    pageNumber: cursorStack.length,
    setPageSize,
    nextPage,
    previousPage,
    canPrevious: cursorStack.length > 1,
    canNext: Boolean(records?.next_cursor),
    filters,
    hasActiveFilters,
    activeFilterCount: filters.selectedTypes.length
      + filters.selectedHours.length
      + filters.selectedDays.length,
    toggleType,
    toggleHour,
    toggleDay,
    clearFilters,
    downloadCsv,
  };
}

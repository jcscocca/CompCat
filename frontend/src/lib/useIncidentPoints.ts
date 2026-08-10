import { useEffect, useRef, useState } from "react";

import { friendlyMessageOr, getIncidentPoints } from "../api/client";
import { isValidAnalysisDateRange } from "./analysisDateRange";
import type { AnalysisSettings, IncidentPoint, IncidentPointsResponse, LayerKey, MapBounds } from "../types";

const INITIAL_OR_SCOPE_DEBOUNCE_MS = 300;
const VIEWPORT_DEBOUNCE_MS = 700;

export type IncidentFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: {
      id: string;
      offense_category: string | null;
      offense_subcategory: string | null;
      occurred_at: string | null;
      block_address: string | null;
      record_count: number;
      location_count?: number;
    };
    geometry: { type: "Point"; coordinates: [number, number] };
  }>;
};

const EMPTY: IncidentFeatureCollection = { type: "FeatureCollection", features: [] };

function emptyCounts() {
  return {
    returned: 0,
    total: 0,
    returnedLocations: 0,
    totalLocations: 0,
    layerTotals: null as Record<LayerKey, number> | null,
    unmappable: 0,
    limit: 0,
  };
}

function toGeoJSON(points: IncidentPoint[]): IncidentFeatureCollection {
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      properties: {
        id: point.id,
        offense_category: point.offense_category,
        offense_subcategory: point.offense_subcategory,
        occurred_at: point.occurred_at,
        block_address: point.block_address,
        record_count: point.record_count,
      },
      geometry: { type: "Point", coordinates: [point.longitude, point.latitude] },
    })),
  };
}

/**
 * Debounced, abortable viewport-driven fetch of incident points for the map dot layer.
 * Initial and semantic-scope requests retain the 300 ms cadence; bounds-only refreshes after
 * a successful response wait 700 ms and keep that response visible until its replacement
 * arrives. One timer/controller lane plus a request-generation guard prevents an older scope
 * from committing after a newer change. bounds === null holds off the first fetch until the
 * map reports a viewport. radiusM is intentionally excluded from the dep array — the dot
 * layer does not depend on radius. Each GeoJSON feature is one block-level coordinate with a
 * record_count, so co-located records stay visible after client clustering ends.
 */
export function useIncidentPoints({
  bounds,
  analysis,
  enabled = true,
}: {
  bounds: MapBounds | null;
  analysis: AnalysisSettings;
  enabled?: boolean;
}) {
  const [geojson, setGeojson] = useState<IncidentFeatureCollection>(EMPTY);
  const [counts, setCounts] = useState(emptyCounts);
  const [error, setError] = useState<string | null>(null);
  // A repeated failure may have identical copy but represents a new request and deserves a
  // fresh warning. Consumers use this occurrence id instead of permanently dismissing by text.
  const [errorId, setErrorId] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const errorSequenceRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scopeKeyRef = useRef<string | null>(null);
  const hasSuccessfulResponseRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const { startDate, endDate, offenseCategory, layer } = analysis;
  const scopeKey = JSON.stringify([startDate, endDate, offenseCategory, layer, enabled]);

  useEffect(() => {
    const scopeChanged = scopeKeyRef.current !== null && scopeKeyRef.current !== scopeKey;
    scopeKeyRef.current = scopeKey;
    requestGenerationRef.current += 1;
    const requestGeneration = requestGenerationRef.current;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;

    if (!bounds || !enabled || !isValidAnalysisDateRange(startDate, endDate)) {
      hasSuccessfulResponseRef.current = false;
      setGeojson(EMPTY);
      setCounts(emptyCounts());
      setError(null);
      setRefreshing(false);
      setStale(false);
      return undefined;
    }

    const preservePriorResponse = !scopeChanged && hasSuccessfulResponseRef.current;
    if (!preservePriorResponse) {
      // Semantic-scope changes must never relabel the prior scope's dots or counts.
      hasSuccessfulResponseRef.current = false;
      setGeojson(EMPTY);
      setCounts(emptyCounts());
      setStale(false);
    }
    setError(null);
    setRefreshing(true);

    const controller = new AbortController();
    abortRef.current = controller;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      getIncidentPoints(
        {
          bounds,
          analysis_start_date: startDate,
          analysis_end_date: endDate,
          offense_category: offenseCategory || null,
          layer,
        },
        controller.signal,
      )
        .then((response: IncidentPointsResponse) => {
          if (controller.signal.aborted || requestGeneration !== requestGenerationRef.current) return;
          hasSuccessfulResponseRef.current = true;
          setGeojson(toGeoJSON(response.points));
          setCounts({
            returned: response.returned_count,
            total: response.total_count,
            returnedLocations: response.returned_location_count,
            totalLocations: response.total_location_count,
            layerTotals: response.layer_totals,
            unmappable: response.unmappable_citywide_count,
            limit: response.limit,
          });
          setError(null);
          setRefreshing(false);
          setStale(false);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || requestGeneration !== requestGenerationRef.current) return;
          if (preservePriorResponse) {
            // Keep the last same-scope response on a transient viewport failure, but mark it
            // as belonging to the previous view until a later refresh succeeds.
            setStale(true);
          } else {
            hasSuccessfulResponseRef.current = false;
            setGeojson(EMPTY);
            setCounts(emptyCounts());
            setStale(false);
          }
          setError(friendlyMessageOr(cause, "Incident pins could not load for this view."));
          errorSequenceRef.current += 1;
          setErrorId(errorSequenceRef.current);
          setRefreshing(false);
        });
    }, preservePriorResponse ? VIEWPORT_DEBOUNCE_MS : INITIAL_OR_SCOPE_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      controller.abort();
    };
  }, [bounds, startDate, endDate, offenseCategory, layer, enabled, scopeKey]);

  return {
    geojson,
    returnedCount: counts.returned,
    totalCount: counts.total,
    returnedLocationCount: counts.returnedLocations,
    totalLocationCount: counts.totalLocations,
    layerTotals: counts.layerTotals,
    unmappableCitywideCount: counts.unmappable,
    limit: counts.limit,
    error,
    errorId,
    refreshing,
    stale,
  };
}

import { useEffect, useRef, useState } from "react";

import { friendlyMessageOr, getIncidentPoints } from "../api/client";
import type { AnalysisSettings, IncidentPoint, IncidentPointsResponse, LayerKey, MapBounds } from "../types";

const DEBOUNCE_MS = 300;

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
    };
    geometry: { type: "Point"; coordinates: [number, number] };
  }>;
};

const EMPTY: IncidentFeatureCollection = { type: "FeatureCollection", features: [] };

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
 * Mirrors useAddressSearch's debounce+abort mechanics: a ~300 ms trailing debounce on
 * bounds/analysis changes, an AbortController per request, and signal.aborted guards so a
 * superseded request never writes its result. bounds === null holds off the first fetch
 * until the map reports a viewport. radiusM is intentionally excluded from the dep array —
 * the dot layer does not depend on radius. Each GeoJSON feature is one block-level coordinate
 * with a record_count, so co-located records stay visible after client clustering ends. Emits
 * record and location counts for the coverage chip.
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
  const [counts, setCounts] = useState({
    returned: 0,
    total: 0,
    returnedLocations: 0,
    totalLocations: 0,
    layerTotals: null as Record<LayerKey, number> | null,
    unmappable: 0,
    limit: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { startDate, endDate, offenseCategory, layer } = analysis;

  useEffect(() => {
    if (!bounds || !enabled) {
      if (!enabled) {
        abortRef.current?.abort();
        setGeojson(EMPTY);
        setCounts({ returned: 0, total: 0, returnedLocations: 0, totalLocations: 0, layerTotals: null, unmappable: 0, limit: 0 });
        setError(null);
      }
      return undefined;
    }
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    timerRef.current = setTimeout(() => {
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
          if (controller.signal.aborted) return;
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
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(friendlyMessageOr(cause, "Incident pins could not load for this view."));
        });
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      controller.abort();
    };
  }, [bounds, startDate, endDate, offenseCategory, layer, enabled]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
  };
}

import { useEffect, useRef, useState } from "react";

import { getIncidentPoints } from "../api/client";
import type { AnalysisSettings, IncidentPoint, IncidentPointsResponse, MapBounds } from "../types";

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
 * the dot layer does not depend on radius. Emits GeoJSON for the map plus the raw counts
 * (returned/total/unmappable-citywide/limit) for the coverage chip.
 */
export function useIncidentPoints({
  bounds,
  analysis,
}: {
  bounds: MapBounds | null;
  analysis: AnalysisSettings;
}) {
  const [geojson, setGeojson] = useState<IncidentFeatureCollection>(EMPTY);
  const [counts, setCounts] = useState({ returned: 0, total: 0, unmappable: 0, limit: 0 });
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { startDate, endDate, offenseCategory, layer } = analysis;

  useEffect(() => {
    if (!bounds) {
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
            unmappable: response.unmappable_citywide_count,
            limit: response.limit,
          });
          setError(null);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "incident points failed");
        });
    }, DEBOUNCE_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      controller.abort();
    };
  }, [bounds, startDate, endDate, offenseCategory, layer]);

  useEffect(() => () => abortRef.current?.abort(), []);

  return {
    geojson,
    returnedCount: counts.returned,
    totalCount: counts.total,
    unmappableCitywideCount: counts.unmappable,
    limit: counts.limit,
    error,
  };
}

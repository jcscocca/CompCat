import { useMemo, useState } from "react";

import { createRouteAlternatives } from "../api/client";
import { parseRouteGeometry } from "./routeGeometry";
import type { AnalysisSettings, RouteComparison, RouteEndpointInput, RouteLine } from "../types";

export interface RoutesController {
  result: RouteComparison | null;
  running: boolean;
  error: string;
  routeLines: RouteLine[];
  runRoute: (
    origin: RouteEndpointInput,
    destination: RouteEndpointInput,
    mode: string,
  ) => Promise<void>;
}

/**
 * Owns the Routes tab: the route-alternatives request (using the shared analysis date
 * range + radius), its running/error state, and the derived map polylines. Fully
 * isolated from selection/analysis-context invalidation — it only reads the settings.
 */
export function useRoutes(analysis: AnalysisSettings): RoutesController {
  const [result, setResult] = useState<RouteComparison | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");

  const runRoute = async (
    origin: RouteEndpointInput,
    destination: RouteEndpointInput,
    mode: string,
  ) => {
    setRunning(true);
    setError("");
    try {
      const comparison = await createRouteAlternatives({
        origin,
        destination,
        mode,
        analysis_start_date: analysis.startDate,
        analysis_end_date: analysis.endDate,
        radii_m: [analysis.radiusM],
      });
      setResult(comparison);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to compare routes.");
    } finally {
      setRunning(false);
    }
  };

  const routeLines = useMemo<RouteLine[]>(() => {
    if (!result) return [];
    const recommendedId = result.statistical_comparison?.overview.recommendation_option_id ?? null;
    return result.alternatives
      .map((alt) => ({
        id: alt.id,
        points: parseRouteGeometry(alt.summary_geometry),
        recommended: alt.id === recommendedId,
      }))
      .filter((line) => line.points.length >= 2);
  }, [result]);

  return { result, running, error, routeLines, runRoute };
}

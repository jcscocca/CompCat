import { useRef, useState } from "react";

import { analyzePlaces, getIncidentDetails, getNeighborhoodAnalysis } from "../api/client";
import type { AnalysisSettings, IncidentDetailsResponse, NeighborhoodAnalysis } from "../types";

export interface AnalyzeController {
  running: boolean;
  incidentDetails: IncidentDetailsResponse | null;
  neighborhood: NeighborhoodAnalysis | null;
  runAnalyze: () => Promise<void>;
  /** Drop in-flight + current results (selection or analysis controls changed). */
  invalidate: () => void;
  /** Apply analyst-provided result slices directly (no re-fetch). */
  applyAssistant: (next: {
    neighborhood?: NeighborhoodAnalysis | null;
    incidents?: IncidentDetailsResponse | null;
  }) => void;
}

interface AnalyzeDeps {
  selectedIds: Set<string>;
  analysis: AnalysisSettings;
  refreshWithFallback: (fallbackMessage: string) => Promise<void>;
  setError: (message: string) => void;
  points?: { latitude: number; longitude: number; label: string }[];
}

/**
 * Owns the Analyze tab: runs the analysis for the current selection and fetches the
 * incident-detail + neighborhood slices behind it. Per-slice version refs guard against
 * a stale in-flight response landing after the selection/controls have moved on
 * (`invalidate` bumps them). `applyAssistant` lets the chat agent populate the panes
 * directly without a manual run.
 */
export function useAnalyze({ selectedIds, analysis, refreshWithFallback, setError, points }: AnalyzeDeps): AnalyzeController {
  const [running, setRunning] = useState(false);
  const [incidentDetails, setIncidentDetails] = useState<IncidentDetailsResponse | null>(null);
  const [neighborhood, setNeighborhood] = useState<NeighborhoodAnalysis | null>(null);
  const incidentDetailsVersionRef = useRef(0);
  const neighborhoodVersionRef = useRef(0);

  function invalidate() {
    incidentDetailsVersionRef.current += 1;
    setIncidentDetails(null);
    neighborhoodVersionRef.current += 1;
    setNeighborhood(null);
  }

  async function runAnalyze() {
    const usePoints = points && points.length >= 1;
    if (!usePoints && selectedIds.size < 1) return;
    setError("");
    setRunning(true);
    const version = incidentDetailsVersionRef.current + 1;
    incidentDetailsVersionRef.current = version;
    setIncidentDetails(null);
    const nVersion = neighborhoodVersionRef.current + 1;
    neighborhoodVersionRef.current = nVersion;
    setNeighborhood(null);
    const payload = {
      ...(usePoints ? { points } : { place_ids: Array.from(selectedIds) }),
      analysis_start_date: analysis.startDate,
      analysis_end_date: analysis.endDate,
      radii_m: [analysis.radiusM],
      offense_category: analysis.offenseCategory || null,
      layer: analysis.layer,
    };
    try {
      await analyzePlaces(payload);
      const details = await getIncidentDetails(payload);
      if (incidentDetailsVersionRef.current === version) setIncidentDetails(details);
      const neighborhoodResult = await getNeighborhoodAnalysis(payload);
      if (neighborhoodVersionRef.current === nVersion) setNeighborhood(neighborhoodResult);
      await refreshWithFallback("Analysis ran, but dashboard totals could not refresh.");
    } catch {
      setError("Unable to run analysis. Try again.");
    } finally {
      setRunning(false);
    }
  }

  function applyAssistant(next: {
    neighborhood?: NeighborhoodAnalysis | null;
    incidents?: IncidentDetailsResponse | null;
  }) {
    if (next.neighborhood !== undefined) setNeighborhood(next.neighborhood);
    if (next.incidents !== undefined) setIncidentDetails(next.incidents);
  }

  return { running, incidentDetails, neighborhood, runAnalyze, invalidate, applyAssistant };
}

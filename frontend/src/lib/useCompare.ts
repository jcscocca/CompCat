import { useRef, useState } from "react";

import { analyzePlaces, comparePlaces, getIncidentDetails, getNeighborhoodAnalysis } from "../api/client";
import type { AnalysisSettings, IncidentDetailsResponse, NeighborhoodAnalysis, SiteComparison } from "../types";
import type { AddressEntry } from "./useCompareSet";

export interface CompareController {
  running: boolean;
  /** Cross-address ranking; null below two entries or when the compare call failed. */
  comparison: SiteComparison | null;
  /** Per-address neighborhood context; null when unavailable. */
  neighborhood: NeighborhoodAnalysis | null;
  /** Combined incident disclosure rows for the whole list; null when unavailable. */
  incidents: IncidentDetailsResponse | null;
  /** Snapshot of the points the last run was computed from (expansion coords, letters).
   * Set after every run — even a fully failed one — so consumers must gate result
   * regions on the data slices (comparison/neighborhood), not on runPoints. */
  runPoints: AddressEntry[] | null;
  run: () => Promise<void>;
  /** Drop in-flight + current results (list or analysis controls changed). */
  invalidate: () => void;
  /** Apply analyst-provided slices directly (no re-fetch). The applied slice becomes the
   * source of truth; the other pane is cleared, and runPoints resets (assistant results
   * are keyed to saved-place selections, not this list's snapshot). */
  applyAssistant: (next: {
    comparison?: SiteComparison | null;
    neighborhood?: NeighborhoodAnalysis | null;
    incidents?: IncidentDetailsResponse | null;
  }) => void;
}

interface CompareDeps {
  entries: AddressEntry[];
  analysis: AnalysisSettings;
  setError: (message: string) => void;
  /** Called after a successful saved-place summary refresh (place_ids analyze path). */
  onSummariesRefreshed?: () => void;
}

const RUN_ERROR = "Unable to run this analysis. Try again.";

/**
 * The unified surface's single run: neighborhood + incident details for every entry
 * (always via inline points), the cross-address comparison at 2+, and — when the list
 * contains saved places — a place_ids analyze pass so persisted crime summaries (map
 * rings, dashboard totals) stay fresh. All calls run in parallel and fail independently;
 * the primary payload (comparison at 2+, neighborhood at 1) failing is the run error.
 * One version ref gates every result write, including `running`.
 */
export function useCompare({ entries, analysis, setError, onSummariesRefreshed }: CompareDeps): CompareController {
  const [running, setRunning] = useState(false);
  const [comparison, setComparison] = useState<SiteComparison | null>(null);
  const [neighborhood, setNeighborhood] = useState<NeighborhoodAnalysis | null>(null);
  const [incidents, setIncidents] = useState<IncidentDetailsResponse | null>(null);
  const [runPoints, setRunPoints] = useState<AddressEntry[] | null>(null);
  const versionRef = useRef(0);

  function invalidate() {
    versionRef.current += 1;
    setComparison(null);
    setNeighborhood(null);
    setIncidents(null);
    setRunPoints(null);
    setRunning(false);
  }

  async function run() {
    if (entries.length < 1) return;
    setError("");
    setRunning(true);
    const version = versionRef.current + 1;
    versionRef.current = version;
    const snapshot = entries.map((e) => ({ ...e, label: e.label.slice(0, 120) }));
    const points = snapshot.map(({ latitude, longitude, label }) => ({ latitude, longitude, label }));
    const savedIds = snapshot.map((e) => e.savedPlaceId).filter((id): id is string => Boolean(id));
    const shared = {
      analysis_start_date: analysis.startDate,
      analysis_end_date: analysis.endDate,
      offense_category: analysis.offenseCategory || null,
      layer: analysis.layer,
    };
    const analyzePayload = { points, ...shared, radii_m: [analysis.radiusM] };
    const wantCompare = snapshot.length >= 2;

    const [neighborhoodResult, incidentsResult, compareResult, summariesResult] = await Promise.allSettled([
      getNeighborhoodAnalysis(analyzePayload),
      getIncidentDetails(analyzePayload),
      wantCompare
        ? comparePlaces({ points, ...shared, radius_m: analysis.radiusM })
        : Promise.resolve(null),
      savedIds.length > 0
        ? analyzePlaces({ place_ids: savedIds, ...shared, radii_m: [analysis.radiusM] })
        : Promise.resolve(null),
    ]);

    if (versionRef.current === version) {
      setNeighborhood(neighborhoodResult.status === "fulfilled" ? neighborhoodResult.value : null);
      setIncidents(incidentsResult.status === "fulfilled" ? incidentsResult.value : null);
      setComparison(compareResult.status === "fulfilled" ? compareResult.value : null);
      setRunPoints(snapshot);
      const primaryFailed = wantCompare
        ? compareResult.status === "rejected"
        : neighborhoodResult.status === "rejected";
      if (primaryFailed) setError(RUN_ERROR);
      if (summariesResult.status === "fulfilled" && summariesResult.value !== null) onSummariesRefreshed?.();
      setRunning(false);
    }
  }

  function applyAssistant(next: {
    comparison?: SiteComparison | null;
    neighborhood?: NeighborhoodAnalysis | null;
    incidents?: IncidentDetailsResponse | null;
  }) {
    versionRef.current += 1;
    if (next.comparison !== undefined) {
      setComparison(next.comparison);
      setNeighborhood(null);
      setIncidents(null);
    }
    if (next.neighborhood !== undefined || next.incidents !== undefined) {
      setComparison(null);
      if (next.neighborhood !== undefined) setNeighborhood(next.neighborhood);
      if (next.incidents !== undefined) setIncidents(next.incidents);
    }
    setRunPoints(null);
    setRunning(false);
  }

  return { running, comparison, neighborhood, incidents, runPoints, run, invalidate, applyAssistant };
}

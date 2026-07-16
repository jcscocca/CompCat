import { useRef, useState } from "react";

import { comparePlaces, getNeighborhoodAnalysis } from "../api/client";
import type { AnalysisSettings, NeighborhoodAnalysis, SiteComparison } from "../types";

export interface CompareController {
  running: boolean;
  comparison: SiteComparison | null;
  /** Per-address neighborhood context for the same run; null when unavailable. */
  neighborhood: NeighborhoodAnalysis | null;
  runCompare: () => Promise<void>;
  /** Drop in-flight + current comparison (selection or analysis controls changed). */
  invalidate: () => void;
  /** Apply an analyst-provided comparison directly (no re-fetch). */
  applyAssistant: (comparison: SiteComparison | null) => void;
}

interface CompareDeps {
  selectedIds: Set<string>;
  analysis: AnalysisSettings;
  setError: (message: string) => void;
  points?: { latitude: number; longitude: number; label: string }[];
}

/**
 * Owns the Compare tab: runs the side-by-side comparison for the current selection at a
 * single radius, plus the per-address neighborhood analysis in parallel (the ranked rows
 * expand into full context). A version ref guards against a stale in-flight result
 * landing after the selection/controls moved on. The two calls fail independently: a
 * missing neighborhood degrades expansions, only a failed compare is an error.
 * `applyAssistant` lets the chat agent populate the pane (comparison only — expansions
 * degrade until the next manual run).
 */
export function useCompare({ selectedIds, analysis, setError, points }: CompareDeps): CompareController {
  const [running, setRunning] = useState(false);
  const [comparison, setComparison] = useState<SiteComparison | null>(null);
  const [neighborhood, setNeighborhood] = useState<NeighborhoodAnalysis | null>(null);
  const versionRef = useRef(0);

  function invalidate() {
    versionRef.current += 1;
    setComparison(null);
    setNeighborhood(null);
  }

  async function runCompare() {
    const usePoints = points && points.length >= 2;
    if (!usePoints && selectedIds.size < 2) return;
    setError("");
    setRunning(true);
    const version = versionRef.current + 1;
    versionRef.current = version;
    const idPayload = usePoints
      ? { points: points!.map((p) => ({ ...p, label: p.label.slice(0, 120) })) }
      : { place_ids: Array.from(selectedIds) };
    const shared = {
      analysis_start_date: analysis.startDate,
      analysis_end_date: analysis.endDate,
      offense_category: analysis.offenseCategory || null,
      layer: analysis.layer,
    };
    const [compareResult, neighborhoodResult] = await Promise.allSettled([
      comparePlaces({ ...idPayload, ...shared, radius_m: analysis.radiusM }),
      getNeighborhoodAnalysis({ ...idPayload, ...shared, radii_m: [analysis.radiusM] }),
    ]);
    if (versionRef.current === version) {
      if (compareResult.status === "fulfilled") {
        setComparison(compareResult.value);
      } else {
        setComparison(null);
        setError("Unable to compare places. Try again.");
      }
      setNeighborhood(neighborhoodResult.status === "fulfilled" ? neighborhoodResult.value : null);
    }
    setRunning(false);
  }

  function applyAssistant(next: SiteComparison | null) {
    setComparison(next);
    setNeighborhood(null);
  }

  return { running, comparison, neighborhood, runCompare, invalidate, applyAssistant };
}

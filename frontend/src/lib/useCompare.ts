import { useRef, useState } from "react";

import { comparePlaces } from "../api/client";
import type { AnalysisSettings, SiteComparison } from "../types";

export interface CompareController {
  running: boolean;
  comparison: SiteComparison | null;
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
 * single radius. A version ref guards against a stale in-flight comparison landing after
 * the selection/controls moved on. `applyAssistant` lets the chat agent populate the pane.
 */
export function useCompare({ selectedIds, analysis, setError, points }: CompareDeps): CompareController {
  const [running, setRunning] = useState(false);
  const [comparison, setComparison] = useState<SiteComparison | null>(null);
  const versionRef = useRef(0);

  function invalidate() {
    versionRef.current += 1;
    setComparison(null);
  }

  async function runCompare() {
    const usePoints = points && points.length >= 2;
    if (!usePoints && selectedIds.size < 2) return;
    setError("");
    setRunning(true);
    const version = versionRef.current + 1;
    versionRef.current = version;
    try {
      const result = await comparePlaces({
        ...(usePoints ? { points } : { place_ids: Array.from(selectedIds) }),
        analysis_start_date: analysis.startDate,
        analysis_end_date: analysis.endDate,
        radius_m: analysis.radiusM,
        offense_category: analysis.offenseCategory || null,
        layer: analysis.layer,
      });
      if (versionRef.current === version) setComparison(result);
    } catch {
      if (versionRef.current === version) setError("Unable to compare places. Try again.");
    } finally {
      setRunning(false);
    }
  }

  function applyAssistant(next: SiteComparison | null) {
    setComparison(next);
  }

  return { running, comparison, runCompare, invalidate, applyAssistant };
}

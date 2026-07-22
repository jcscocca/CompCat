import type { AnalysisCardData, AnalysisSettings, IncidentDetailsResponse, NeighborhoodAnalysis, SiteComparison } from "../types";

/** Card synthesized from a client-run analysis (share links, lookups, restored
 * sessions run through useCompare — the assistant tools can't take raw points).
 * runId stays null: no run-scoped export, no server badges. */
export function cardFromCompareResults(input: {
  comparison: SiteComparison | null;
  neighborhood: NeighborhoodAnalysis | null;
  incidents: IncidentDetailsResponse | null;
  analysis: AnalysisSettings;
  placeIds: string[];
}): AnalysisCardData | null {
  const { comparison, neighborhood, incidents, analysis, placeIds } = input;
  if (!comparison && !neighborhood) return null;
  return {
    runId: null,
    kind: comparison ? "compare" : "analyze",
    placeIds,
    settings: {
      radius_m: analysis.radiusM,
      analysis_start_date: analysis.startDate,
      analysis_end_date: analysis.endDate,
      offense_category: analysis.offenseCategory || null,
      layer: analysis.layer,
    },
    comparison,
    // A comparison run also fetched the per-address context and incident rows. Keep
    // that frozen payload so expanding the inline card preserves the retired Compare
    // surface's baseline, trend, and incident-detail parity.
    neighborhood,
    incidents,
  };
}

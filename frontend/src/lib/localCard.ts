import type { AnalysisCardData, AnalysisPointPayload, AnalysisSettings, IncidentDetailsResponse, NeighborhoodAnalysis, SiteComparison } from "../types";

/** Card synthesized from a client-run analysis (share links, lookups, restored
 * sessions run through useCompare). A fully saved-place run can carry the owned
 * AnalysisRun id created by the parallel summary refresh; ad-hoc/mixed point runs
 * remain non-exportable. */
export function cardFromCompareResults(input: {
  comparison: SiteComparison | null;
  neighborhood: NeighborhoodAnalysis | null;
  incidents: IncidentDetailsResponse | null;
  analysis: AnalysisSettings;
  placeIds: string[];
  points?: AnalysisPointPayload[];
  runId?: string | null;
}): AnalysisCardData | null {
  const { comparison, neighborhood, incidents, analysis, placeIds, points, runId = null } = input;
  if (!comparison && !neighborhood) return null;
  return {
    runId,
    kind: comparison ? "compare" : "analyze",
    placeIds,
    ...(points && points.length > 0 ? { points } : {}),
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

/** Promote a point-backed local card to a server-recomputable saved-place card once every
 * analyzed entry has been saved. Partial promotion would change a multi-point result's scope,
 * so keep the original card until all ids are present. */
export function cardWithSavedPlaceIds(
  card: AnalysisCardData,
  placeIds: Array<string | undefined>,
): AnalysisCardData {
  if (placeIds.length === 0 || placeIds.some((id) => !id)) return card;
  const savedIds = Array.from(new Set(placeIds as string[]));
  if (savedIds.length === 0) return card;
  return { ...card, placeIds: savedIds, points: undefined };
}

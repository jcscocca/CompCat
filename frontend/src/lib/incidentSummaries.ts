import type { AnalysisSettings, CrimeSummary, DashboardSummary, PersistedAnalysisScope } from "../types";

function summaryLayer(summary: DashboardSummary): AnalysisSettings["layer"] {
  // Summaries created before the layer column was introduced were all reported incidents.
  return summary.layer ?? "reported";
}

function samePlaceIds(scopeIds: string[], currentIds: ReadonlySet<string>): boolean {
  return scopeIds.length === currentIds.size && scopeIds.every((id) => currentIds.has(id));
}

function matchingScope(
  summary: DashboardSummary | null,
  analysis: AnalysisSettings,
  currentPlaceIds: ReadonlySet<string>,
): PersistedAnalysisScope | null {
  const scope = summary?.analysis.persisted_scope;
  const category = analysis.offenseCategory || null;
  if (
    !summary
    || !scope
    || typeof scope.run_id !== "string"
    || !Array.isArray(scope.place_ids)
    || !scope.place_ids.every((id) => typeof id === "string")
    || !Array.isArray(scope.radii_m)
  ) {
    return null;
  }
  const scopePlaceIds = scope.place_ids;
  const scopeRadii = scope.radii_m;
  if (
    !samePlaceIds(scopePlaceIds, currentPlaceIds)
    || !scopeRadii.includes(analysis.radiusM)
    || scope.analysis_start_date !== analysis.startDate
    || scope.analysis_end_date !== analysis.endDate
    || scope.offense_category !== category
    // The global controls cannot represent these narrower filters. Never present their
    // persisted rows as the broader category-only scope visible in the workspace.
    || scope.offense_subcategory !== null
    || scope.nibrs_group !== null
    || scope.layer !== analysis.layer
    || summaryLayer(summary) !== analysis.layer
  ) {
    return null;
  }
  const allRowsBelongToRun = summary.crime_summaries.every(
    (entry) => entry.analysis_run_id === scope.run_id
      && scopePlaceIds.includes(entry.place_cluster_id)
      && scopeRadii.includes(entry.radius_m)
      && entry.analysis_start_date === scope.analysis_start_date
      && entry.analysis_end_date === scope.analysis_end_date
      && (entry.layer ?? "reported") === scope.layer
      && (scope.offense_category === null || entry.offense_category === scope.offense_category)
      && (scope.offense_subcategory === null || entry.offense_subcategory === scope.offense_subcategory)
      && (scope.nibrs_group === null || entry.nibrs_group === scope.nibrs_group),
  );
  if (!allRowsBelongToRun) return null;
  return scope;
}

function entryMatchesScope(entry: CrimeSummary, scope: PersistedAnalysisScope, radiusM: number): boolean {
  return entry.analysis_run_id === scope.run_id
    && entry.radius_m === radiusM
    && entry.analysis_start_date === scope.analysis_start_date
    && entry.analysis_end_date === scope.analysis_end_date
    && (entry.layer ?? "reported") === scope.layer
    // Unfiltered runs contain grouped rows from every observed offense dimension. A filtered
    // run may only contribute rows from its exact requested dimension.
    && (scope.offense_category === null || entry.offense_category === scope.offense_category)
    && (scope.offense_subcategory === null || entry.offense_subcategory === scope.offense_subcategory)
    && (scope.nibrs_group === null || entry.nibrs_group === scope.nibrs_group);
}

/** Whether the persisted run provenance exactly matches the visible analysis scope. */
export function hasIncidentSummaryForAnalysis(
  summary: DashboardSummary | null,
  analysis: AnalysisSettings,
  currentPlaceIds: ReadonlySet<string>,
): boolean {
  return matchingScope(summary, analysis, currentPlaceIds) !== null;
}

export function incidentCountForPlace(
  summary: DashboardSummary | null,
  placeId: string,
  analysis: AnalysisSettings,
  currentPlaceIds: ReadonlySet<string>,
): number | null {
  const scope = matchingScope(summary, analysis, currentPlaceIds);
  if (!summary || !scope || !scope.place_ids?.includes(placeId)) {
    return null;
  }
  const matches = summary.crime_summaries.filter(
    (entry) => entry.place_cluster_id === placeId && entryMatchesScope(entry, scope, analysis.radiusM),
  );
  if (matches.length === 0) {
    return null;
  }
  return matches.reduce((total, entry) => total + entry.incident_count, 0);
}

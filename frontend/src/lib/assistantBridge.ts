import type {
  AnalysisCardData,
  AnalysisReport,
  AnalysisPointPayload,
  AnalysisSettings,
  AssistantToolEffect,
  BadgeDescriptor,
  IncidentDetailsResponse,
  NeighborhoodAnalysis,
  SettingsUsed,
  SiteComparison,
} from "../types";

// SettingsUsed / AnalysisCardData are defined in types.ts (not here) to keep imports
// one-way: types.ts has no dependency on this module, so both this bridge and
// threadItems.ts can import from it without a cycle. Re-exported so existing/expected
// import sites (`from "./assistantBridge"`) keep working.
export type { AnalysisCardData, SettingsUsed };

// Tool results arrive off the SSE stream as `unknown`. Validate the structural invariants the
// render layer relies on at this boundary and coerce anything malformed to null / [] (a shape
// the cards already handle), so a drifted or truncated server frame degrades gracefully instead
// of throwing deep inside render (e.g. `neighborhood.places.map` when `places` is missing).
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNeighborhood(value: unknown): NeighborhoodAnalysis | null {
  if (isRecord(value) && Array.isArray(value.places) && Array.isArray(value.pairwise)) {
    return value as unknown as NeighborhoodAnalysis;
  }
  return null;
}

function asIncidents(value: unknown): IncidentDetailsResponse | null {
  if (isRecord(value) && Array.isArray(value.incidents)) {
    return value as unknown as IncidentDetailsResponse;
  }
  return null;
}

// The compare render reads nested fields off `comparison`; require at least a non-null object
// so a non-object frame can't be spread/dereferenced as one.
function asComparison(value: unknown): SiteComparison | null {
  return isRecord(value) ? (value as unknown as SiteComparison) : null;
}

function asBadges(value: unknown): BadgeDescriptor[] | null {
  if (!Array.isArray(value)) return null;
  const badges = value.filter(
    (b): b is BadgeDescriptor => isRecord(b) && typeof b.place_id === "string",
  );
  return badges.length > 0 ? badges : null;
}

function asSettingsUsed(value: unknown): SettingsUsed | undefined {
  return isRecord(value) ? (value as SettingsUsed) : undefined;
}

function asReport(value: unknown): AnalysisReport | undefined {
  if (
    isRecord(value)
    && isRecord(value.profile)
    && isRecord(value.scope)
    && isRecord(value.sections)
    && Array.isArray(value.selection)
    && typeof value.generated_at === "string"
  ) {
    return value as unknown as AnalysisReport;
  }
  return undefined;
}

function asPoints(value: unknown): AnalysisPointPayload[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (point): point is AnalysisPointPayload =>
      isRecord(point)
      && typeof point.latitude === "number"
      && typeof point.longitude === "number"
      && typeof point.label === "string",
  );
}

function settingsFrom(used: SettingsUsed | undefined): Partial<AnalysisSettings> {
  if (!used) return {};
  const patch: Partial<AnalysisSettings> = {};
  if (typeof used.radius_m === "number") patch.radiusM = used.radius_m;
  if (typeof used.analysis_start_date === "string") patch.startDate = used.analysis_start_date;
  if (typeof used.analysis_end_date === "string") patch.endDate = used.analysis_end_date;
  // offense_category is null for "all reported"; the UI represents that as "".
  if (used.offense_category !== undefined) patch.offenseCategory = used.offense_category ?? "";
  // Reflect the layer the assistant ran against so the global toggle follows it.
  if (used.layer === "reported" || used.layer === "arrests" || used.layer === "calls") patch.layer = used.layer;
  return patch;
}

export function interpretToolResult(data: {
  tool_name?: string;
  result?: unknown;
}): AssistantToolEffect | null {
  const result = (data.result ?? {}) as Record<string, unknown>;
  switch (data.tool_name) {
    case "compare_places": {
      const placeIds = Array.isArray(result.place_ids) ? (result.place_ids as string[]) : [];
      const points = asPoints(result.points);
      const comparison = asComparison(result.comparison);
      const neighborhood = asNeighborhood(result.neighborhood);
      const incidents = asIncidents(result.incidents);
      const badges = asBadges(result.badges);
      const report = asReport(result.report);
      return {
        ...(points.length === 0 ? { selection: { mode: "replace" as const, ids: placeIds } } : {}),
        settings: settingsFrom(asSettingsUsed(result.settings_used)),
        comparison,
        neighborhood,
        incidents,
        refetchSummary: points.length === 0,
        ...(badges ? { badges } : {}),
        card: {
          runId: typeof result.analysis_run_id === "string" ? result.analysis_run_id : null,
          kind: "compare",
          placeIds,
          ...(points.length > 0 ? { points } : {}),
          settings: asSettingsUsed(result.settings_used) ?? {},
          comparison,
          neighborhood,
          incidents,
          ...(report ? { report } : {}),
        },
      };
    }
    case "analyze_places": {
      const placeIds = Array.isArray(result.place_ids) ? (result.place_ids as string[]) : [];
      const points = asPoints(result.points);
      const neighborhood = asNeighborhood(result.neighborhood);
      const incidents = asIncidents(result.incidents);
      const badges = asBadges(result.badges);
      const report = asReport(result.report);
      return {
        ...(points.length === 0 ? { selection: { mode: "replace" as const, ids: placeIds } } : {}),
        settings: settingsFrom(asSettingsUsed(result.settings_used)),
        neighborhood,
        incidents,
        refetchSummary: points.length === 0,
        ...(badges ? { badges } : {}),
        card: {
          runId: typeof result.analysis_run_id === "string" ? result.analysis_run_id : null,
          kind: "analyze",
          placeIds,
          ...(points.length > 0 ? { points } : {}),
          settings: asSettingsUsed(result.settings_used) ?? {},
          comparison: null,
          neighborhood,
          incidents,
          ...(report ? { report } : {}),
        },
      };
    }
    case "add_place": {
      const place = (result.place ?? {}) as { id?: string };
      if (!place.id) return null;
      return { selection: { mode: "add", ids: [place.id] }, refetchSummary: true };
    }
    case "select_places": {
      const rawMode = result.mode;
      const mode: "replace" | "add" | "clear" =
        rawMode === "add" || rawMode === "clear" ? rawMode : "replace";
      return {
        selection: {
          mode,
          ids: Array.isArray(result.place_ids) ? (result.place_ids as string[]) : [],
        },
      };
    }
    case "update_filters":
      return { settings: settingsFrom(asSettingsUsed(result.patch)) };
    default:
      return null;
  }
}

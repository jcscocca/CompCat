import type {
  AnalysisCardData,
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
      const comparison = (result.comparison as SiteComparison) ?? null;
      const neighborhood = (result.neighborhood as NeighborhoodAnalysis) ?? null;
      const incidents = (result.incidents as IncidentDetailsResponse) ?? null;
      return {
        selection: { mode: "replace", ids: placeIds },
        settings: settingsFrom(result.settings_used as SettingsUsed),
        comparison,
        neighborhood,
        incidents,
        refetchSummary: true,
        ...(Array.isArray(result.badges) ? { badges: result.badges as BadgeDescriptor[] } : {}),
        card: {
          runId: typeof result.analysis_run_id === "string" ? result.analysis_run_id : null,
          kind: "compare",
          placeIds,
          settings: (result.settings_used as SettingsUsed) ?? {},
          comparison,
          neighborhood,
          incidents,
        },
      };
    }
    case "analyze_places": {
      const placeIds = Array.isArray(result.place_ids) ? (result.place_ids as string[]) : [];
      const neighborhood = (result.neighborhood as NeighborhoodAnalysis) ?? null;
      const incidents = (result.incidents as IncidentDetailsResponse) ?? null;
      return {
        selection: { mode: "replace", ids: placeIds },
        settings: settingsFrom(result.settings_used as SettingsUsed),
        neighborhood,
        incidents,
        refetchSummary: true,
        ...(Array.isArray(result.badges) ? { badges: result.badges as BadgeDescriptor[] } : {}),
        card: {
          runId: typeof result.analysis_run_id === "string" ? result.analysis_run_id : null,
          kind: "analyze",
          placeIds,
          settings: (result.settings_used as SettingsUsed) ?? {},
          comparison: null,
          neighborhood,
          incidents,
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
      return { settings: settingsFrom(result.patch as SettingsUsed) };
    default:
      return null;
  }
}

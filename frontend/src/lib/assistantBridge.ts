import type {
  AnalysisSettings,
  AssistantToolEffect,
  IncidentDetailsResponse,
  LayerKey,
  NeighborhoodAnalysis,
  SiteComparison,
} from "../types";

// Mirrors the backend `_settings_used` echo (app/assistant/tools.py): only the fields the
// dashboard's AnalysisSettings can apply. offense_subcategory / nibrs_group are honored as
// filters server-side but intentionally not echoed (no UI control), keeping the contract 1:1.
type SettingsUsed = {
  radius_m?: number;
  analysis_start_date?: string;
  analysis_end_date?: string;
  offense_category?: string | null;
  layer?: LayerKey;
};

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
    case "compare_places":
      return {
        selection: { mode: "replace", ids: Array.isArray(result.place_ids) ? (result.place_ids as string[]) : [] },
        settings: settingsFrom(result.settings_used as SettingsUsed),
        comparison: (result.comparison as SiteComparison) ?? null,
        refetchSummary: true,
        tab: "compare",
      };
    case "analyze_places":
      return {
        selection: { mode: "replace", ids: Array.isArray(result.place_ids) ? (result.place_ids as string[]) : [] },
        settings: settingsFrom(result.settings_used as SettingsUsed),
        neighborhood: (result.neighborhood as NeighborhoodAnalysis) ?? null,
        incidents: (result.incidents as IncidentDetailsResponse) ?? null,
        refetchSummary: true,
        tab: "compare",
      };
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
    default:
      return null;
  }
}

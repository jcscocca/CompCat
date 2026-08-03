import type { AnalysisCardData, AnalysisReport } from "../types";
import type { ThreadItem } from "./threadItems";

const KEY = "compcat.analysis-report-history.v1";
const LIMIT = 10;

function isReport(value: unknown): value is AnalysisReport {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AnalysisReport>;
  return typeof candidate.generated_at === "string"
    && typeof candidate.schema_version === "string"
    && typeof candidate.profile === "object"
    && typeof candidate.scope === "object"
    && typeof candidate.sections === "object"
    && Array.isArray(candidate.selection);
}

function historyCard(report: AnalysisReport): AnalysisCardData {
  return {
    runId: null,
    kind: report.selection_kind === "multi_place" ? "compare" : "analyze",
    placeIds: [],
    settings: {
      radius_m: report.scope.radius_m,
      analysis_start_date: report.scope.effective_start_date,
      analysis_end_date: report.scope.effective_end_date,
      offense_category: report.scope.filters.offense_category,
      offense_subcategory: report.scope.filters.offense_subcategory
        ?? report.scope.filters.arrest_offense_description
        ?? report.scope.filters.call_type,
      nibrs_group: report.scope.filters.nibrs_group,
      layer: report.scope.layer,
    },
    comparison: null,
    neighborhood: null,
    incidents: null,
    report,
  };
}

export function loadReportHistory(): ThreadItem[] {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isReport).slice(-LIMIT).map((report) => ({ kind: "analysis_card", card: historyCard(report) }));
  } catch {
    return [];
  }
}

export function saveReportHistory(items: ThreadItem[]): void {
  try {
    const reports = items
      .filter((item): item is Extract<ThreadItem, { kind: "analysis_card" }> => item.kind === "analysis_card" && Boolean(item.card.report))
      .map((item) => item.card.report as AnalysisReport)
      .slice(-LIMIT);
    sessionStorage.setItem(KEY, JSON.stringify(reports));
  } catch {
    // Session storage can be unavailable or full. Reports remain in the in-memory thread.
  }
}

import { categoryLabel } from "./offenseCategories";
import { incidentNoun } from "./layerCopy";
import type { AnalysisSettings } from "../types";

/** Human-readable receipt for a settings patch, or null if it's a no-op.
 * Receipts land in the Tabby thread so filter changes leave a visible trail. */
export function describeAnalysisPatch(
  current: AnalysisSettings,
  patch: Partial<AnalysisSettings>,
): string | null {
  const next = { ...current, ...patch };
  const parts: string[] = [];
  if (next.startDate !== current.startDate || next.endDate !== current.endDate) {
    parts.push(`Date range → ${next.startDate} – ${next.endDate}`);
  }
  if (next.radiusM !== current.radiusM) {
    parts.push(`Search radius → ${next.radiusM} m`);
  }
  if (next.offenseCategory !== current.offenseCategory) {
    parts.push(`Categories → ${categoryLabel(next.offenseCategory)}`);
  }
  if (next.layer !== current.layer) {
    parts.push(`Layer → ${incidentNoun(next.layer).pluralCap}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}

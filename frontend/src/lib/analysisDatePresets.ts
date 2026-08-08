import { ANALYSIS_MIN_DATE } from "./analysisDefaults";

export type AnalysisDatePreset = "30-days" | "90-days" | "year";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIsoDate(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = Date.UTC(year, month - 1, day);
  const date = new Date(parsed);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    ? parsed
    : null;
}

function isoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Presets end on the active data window, not the wall clock, so stale layers stay honest. */
export function analysisDatePresetWindow(
  preset: AnalysisDatePreset,
  activeEndDate: string,
): { startDate: string; endDate: string } | null {
  const end = parseIsoDate(activeEndDate);
  if (end === null) return null;
  const start = preset === "year"
    ? `${activeEndDate.slice(0, 4)}-01-01`
    : isoDate(end - (preset === "30-days" ? 29 : 89) * DAY_MS);
  return {
    startDate: start < ANALYSIS_MIN_DATE ? ANALYSIS_MIN_DATE : start,
    endDate: activeEndDate,
  };
}

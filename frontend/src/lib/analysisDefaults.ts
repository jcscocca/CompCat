export const ANALYSIS_MIN_DATE = "2018-01-01";

type AvailableWindow = {
  data_through: string | null;
  earliest?: string | null;
};

function localDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function currentYearAnalysisWindow(now = new Date()): {
  analysis_start_date: string;
  analysis_end_date: string;
} {
  const start = `${now.getFullYear()}-01-01`;
  return {
    analysis_start_date: start < ANALYSIS_MIN_DATE ? ANALYSIS_MIN_DATE : start,
    analysis_end_date: localDateString(now),
  };
}

/**
 * Default to the calendar year represented by the freshest available row, rather than
 * the wall-clock year. This keeps a lagging historical dataset from opening on a window
 * that can only return zero results. The start is also clamped to the layer's first row.
 */
export function availableDataAnalysisWindow(
  availability: AvailableWindow,
): { analysis_start_date: string; analysis_end_date: string } | null {
  const end = availability.data_through?.slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const yearStart = `${end.slice(0, 4)}-01-01`;
  const earliest = availability.earliest?.slice(0, 10) ?? "";
  const start = [ANALYSIS_MIN_DATE, yearStart, earliest].filter(Boolean).sort().at(-1)!;
  return { analysis_start_date: start > end ? end : start, analysis_end_date: end };
}

export const ANALYSIS_MIN_DATE = "2018-01-01";

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

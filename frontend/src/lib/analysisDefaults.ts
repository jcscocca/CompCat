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
  return {
    analysis_start_date: `${now.getFullYear()}-01-01`,
    analysis_end_date: localDateString(now),
  };
}

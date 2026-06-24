import type { DashboardSummary } from "../types";

type Props = {
  summary: DashboardSummary | null;
};

export function ResultsSummary({ summary }: Props) {
  if (!summary) {
    return null;
  }

  return (
    <section className="panel metrics" aria-label="Current analysis results">
      <div>
        <span className="metric-value">{summary.totals.place_count}</span>
        <span className="metric-label">places</span>
      </div>
      <div>
        <span className="metric-value">{summary.totals.visit_count}</span>
        <span className="metric-label">visits entered</span>
      </div>
      <div>
        <span className="metric-value">{summary.totals.incident_count}</span>
        <span className="metric-label">reported incidents in current summaries</span>
      </div>
    </section>
  );
}

import type { DashboardFreshness } from "../types";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Format a leading YYYY-MM-DD (dates or ISO datetimes) as "Mon D, YYYY", deterministically
// (no locale/timezone dependence so the indicator reads the same everywhere and in tests).
function formatDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const monthName = MONTHS[Number(month) - 1] ?? month;
  return `${monthName} ${Number(day)}, ${year}`;
}

/**
 * A small persistent indicator of how current the shared SPD incident dataset is, so users
 * know the data isn't live. Renders nothing until the freshness has loaded (or when no
 * incident data is present). Powered by GET /dashboard/freshness.
 */
export function DataFreshness({ freshness }: { freshness: DashboardFreshness | null }) {
  if (!freshness || !freshness.data_through) {
    return null;
  }
  const detail = [
    `${freshness.incident_count.toLocaleString()} reported SPD incidents`,
    freshness.earliest ? `from ${formatDate(freshness.earliest)}` : null,
    `through ${formatDate(freshness.data_through)}`,
    freshness.last_ingested_at ? `· ingested ${formatDate(freshness.last_ingested_at)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="mc-status mc-freshness" title={detail}>
      Data through {formatDate(freshness.data_through)}
    </div>
  );
}

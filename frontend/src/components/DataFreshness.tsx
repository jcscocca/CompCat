import type { DashboardFreshness, LayerKey } from "../types";

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
 * know the data isn't live. Reflects the active layer (reported incidents vs 911 calls).
 * Renders nothing while freshness is loading, then distinguishes current, empty, and
 * unavailable data states instead of silently implying that every layer is usable.
 * Powered by GET /dashboard/freshness, which returns one entry per layer.
 */
export function DataFreshness({
  freshness,
  layer = "reported",
  loaded = false,
}: {
  freshness: DashboardFreshness | null;
  layer?: LayerKey;
  loaded?: boolean;
}) {
  const entry = freshness?.[layer];
  const noun =
    layer === "calls" ? "911 calls" : layer === "arrests" ? "SPD arrests" : "reported SPD incidents";
  if (!loaded && !entry) {
    return null;
  }
  if (!freshness) {
    return <div className="mc-status mc-freshness is-unavailable">Data availability unavailable</div>;
  }
  if (!entry?.data_through) {
    return <div className="mc-status mc-freshness is-unavailable">No {noun} data loaded</div>;
  }
  const detail = [
    `${entry.incident_count.toLocaleString()} ${noun}`,
    entry.earliest ? `from ${formatDate(entry.earliest)}` : null,
    `through ${formatDate(entry.data_through)}`,
    entry.last_ingested_at ? `· ingested ${formatDate(entry.last_ingested_at)}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="mc-status mc-freshness" title={detail}>
      Data through {formatDate(entry.data_through)}
    </div>
  );
}

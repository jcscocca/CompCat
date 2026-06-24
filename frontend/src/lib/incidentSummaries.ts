import type { DashboardSummary } from "../types";

export function incidentCountForPlace(
  summary: DashboardSummary | null,
  placeId: string,
  radiusM: number,
): number | null {
  if (!summary) {
    return null;
  }
  const match = summary.crime_summaries.find(
    (entry) => entry.place_cluster_id === placeId && entry.radius_m === radiusM,
  );
  return match ? match.incident_count : null;
}

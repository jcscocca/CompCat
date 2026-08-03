import type { AnalysisReport } from "../types";

export type ReportOverlapMetrics = {
  sharedSourceRecordCount: number | null;
  additionalMembershipCount: number;
  maximumPlacesPerRecord: number | null;
};

export type ReportOverlapExplanation = ReportOverlapMetrics & {
  headline: string;
  detail: string;
};

export function reportOverlapMetrics(report: AnalysisReport): ReportOverlapMetrics {
  const overview = report.sections.overview;
  const stored = overview.overlap_summary;
  const additionalMembershipCount = stored?.additional_membership_count
    ?? Math.max(0, overview.membership_count - overview.unique_source_record_count);
  const sharedSourceRecordCount = stored?.shared_source_record_count
    ?? (additionalMembershipCount === 0
      ? 0
      : report.selection.length === 2
        ? additionalMembershipCount
        : null);
  const maximumPlacesPerRecord = stored?.maximum_places_per_record
    ?? (overview.unique_source_record_count === 0
      ? 0
      : additionalMembershipCount === 0
        ? 1
        : report.selection.length === 2
          ? 2
          : null);

  return {
    sharedSourceRecordCount,
    additionalMembershipCount,
    maximumPlacesPerRecord,
  };
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

export function reportOverlapExplanation(
  report: AnalysisReport,
): ReportOverlapExplanation | null {
  if (report.selection.length < 2) return null;
  const metrics = reportOverlapMetrics(report);
  if (metrics.additionalMembershipCount === 0) return null;

  const memberships = countLabel(report.sections.overview.membership_count, "membership");
  if (report.selection.length === 2 && metrics.sharedSourceRecordCount !== null) {
    return {
      ...metrics,
      headline: `${countLabel(metrics.sharedSourceRecordCount, "source record")} ${metrics.sharedSourceRecordCount === 1 ? "falls" : "fall"} within both selected radii.`,
      detail: `The individual place totals add up to ${memberships} because shared records are counted once for each selected radius.`,
    };
  }
  if (metrics.sharedSourceRecordCount !== null) {
    return {
      ...metrics,
      headline: `${countLabel(metrics.sharedSourceRecordCount, "source record")} ${metrics.sharedSourceRecordCount === 1 ? "falls" : "fall"} within more than one selected radius.`,
      detail: `Those shared records create ${countLabel(metrics.additionalMembershipCount, "additional membership")}, so the individual place totals add up to ${memberships}.`,
    };
  }
  return {
    ...metrics,
    headline: `${countLabel(metrics.additionalMembershipCount, "additional membership")} ${metrics.additionalMembershipCount === 1 ? "appears" : "appear"} in the individual place totals.`,
    detail: `Some source records fall within more than one selected radius and are counted once for each radius, for ${memberships} total.`,
  };
}

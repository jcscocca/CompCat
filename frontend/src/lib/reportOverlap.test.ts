import { describe, expect, it } from "vitest";

import type { AnalysisReport } from "../types";
import { reportOverlapExplanation, reportOverlapMetrics } from "./reportOverlap";

function report(
  selectionCount: number,
  uniqueCount: number,
  membershipCount: number,
  overlapSummary?: AnalysisReport["sections"]["overview"]["overlap_summary"],
): AnalysisReport {
  return {
    selection: Array.from({ length: selectionCount }, (_, index) => ({
      selection_id: `selection-${index + 1}`,
    })),
    sections: {
      overview: {
        unique_source_record_count: uniqueCount,
        membership_count: membershipCount,
        overlap_summary: overlapSummary,
      },
    },
  } as unknown as AnalysisReport;
}

describe("report overlap explanation", () => {
  it("omits redundant membership information for a single place", () => {
    expect(reportOverlapExplanation(report(1, 12, 12))).toBeNull();
  });

  it("omits the explanation when multiple place totals contain no overlap", () => {
    expect(reportOverlapExplanation(report(2, 12, 12))).toBeNull();
  });

  it("derives the exact shared-record count for a legacy two-place report", () => {
    const legacy = report(2, 2470, 2512);
    expect(reportOverlapMetrics(legacy)).toEqual({
      sharedSourceRecordCount: 42,
      additionalMembershipCount: 42,
      maximumPlacesPerRecord: 2,
    });
    expect(reportOverlapExplanation(legacy)).toMatchObject({
      headline: "42 source records fall within both selected radii.",
      detail: "The individual place totals add up to 2,512 memberships because shared records are counted once for each selected radius.",
    });
  });

  it("separates shared records from extra memberships across three or more places", () => {
    const threeWay = report(3, 1, 3, {
      shared_source_record_count: 1,
      additional_membership_count: 2,
      maximum_places_per_record: 3,
    });
    expect(reportOverlapExplanation(threeWay)).toMatchObject({
      sharedSourceRecordCount: 1,
      additionalMembershipCount: 2,
      maximumPlacesPerRecord: 3,
      headline: "1 source record falls within more than one selected radius.",
      detail: "Those shared records create 2 additional memberships, so the individual place totals add up to 3 memberships.",
    });
  });

  it("uses only mathematically safe copy for legacy reports with three or more places", () => {
    const legacy = report(3, 10, 12);
    expect(reportOverlapExplanation(legacy)).toMatchObject({
      sharedSourceRecordCount: null,
      additionalMembershipCount: 2,
      headline: "2 additional memberships appear in the individual place totals.",
    });
  });
});

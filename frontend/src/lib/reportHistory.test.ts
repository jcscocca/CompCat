import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { deletePersonalData } from "../api/client";
import type { AnalysisCardData, AnalysisReport } from "../types";
import { loadReportHistory, saveReportHistory } from "./reportHistory";
import { useThread } from "./useThread";

function card(id: string): AnalysisCardData {
  const unit = "reported_offense_record";
  const report: AnalysisReport = {
    report_id: id, schema_version: "1.1", method_version: "analysis-report-v1",
    generated_at: "2026-09-06T12:00:00Z", selection_kind: "single_place",
    comparison_mode: "none", status: "complete",
    selection: [{ selection_id: "selection-1", label: "Test place", latitude: 47.61, longitude: -122.33 }],
    profile: {
      profile_version: "1.0", layer: "reported", report_title: "Reported Incident Context Report",
      source_dataset: "seattle_spd_crime", counting_unit: unit, counting_unit_label: "Reported-offense record",
      record_noun_singular: "reported incident record", record_noun_plural: "reported incident records",
      primary_time_field: "occurred_at", primary_time_label: "Recorded time",
      secondary_time_field: null, secondary_time_label: null,
      subtype_field: "offense_subcategory", subtype_label: "Offense subcategory", supported_filters: [],
      capabilities: { reference_context: true, modeled_comparison: true, contextual_trend: false }, disclosures: [],
    },
    scope: {
      radius_m: 250, layer: "reported", source_dataset: "seattle_spd_crime", counting_unit: unit,
      filters: { offense_category: null, offense_subcategory: null, arrest_offense_description: null, call_type: null, nibrs_group: null },
      requested_start_date: "2024-01-01", requested_end_date: "2024-01-31",
      effective_start_date: "2024-01-01", effective_end_date: "2024-01-31",
      available_start_date: "2008-01-01", latest_recorded_event_date: null,
      latest_row_ingested_at: null, confirmed_data_through: null,
    },
    sections: {
      overview: { counting_unit: unit, unique_counting_basis: "unique_source_records", membership_counting_basis: "per_place_membership", unique_source_record_count: 0, membership_count: 0, returned_record_count: 0, record_limit: 100, records_truncated: false },
      place_context: [], comparison: null,
      records: { counting_unit: unit, counting_basis: "per_place_membership", total_membership_count: 0, returned_count: 0, limit: 100, truncated: false, records: [] },
    },
    section_statuses: [], disclosures: [],
    export_policy: { artifact_coordinate_decimals: 3, exact_coordinates_in_artifact: false, includes_owner_hash: false, includes_internal_place_ids: false, persisted_server_side: true, privacy_policy_checked_at: "2026-09-06T12:00:00Z", download_revalidation: "block_if_saved_place_deleted_or_sensitive" },
  };
  saveReportHistory([{ kind: "analysis_card", card: {
    report, runId: null, kind: "analyze", placeIds: [], settings: {},
    comparison: null, neighborhood: null, incidents: null,
  } }]);
  const item = loadReportHistory()[0];
  if (item.kind !== "analysis_card") throw new Error("Expected report fixture");
  return item.card;
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("personal-data erasure and report history", () => {
  it("removes erased reports from the mounted thread and tab storage, preserving other history", async () => {
    const uploaded = card("uploaded-report");
    const manual = card("manual-report");
    saveReportHistory([
      { kind: "analysis_card", card: uploaded },
      { kind: "analysis_card", card: manual },
    ]);
    const { result, unmount } = renderHook(() => useThread());
    act(() => result.current.append({ kind: "user_text", text: "My remaining conversation" }));
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      place_clusters: 1, analysis_report_snapshots: 1, deleted_report_ids: ["uploaded-report"],
    }), { status: 200 }));

    await act(async () => { await deletePersonalData(); });

    expect(result.current.items).toEqual([
      { kind: "analysis_card", card: manual },
      { kind: "user_text", text: "My remaining conversation" },
    ]);
    unmount();
    expect(loadReportHistory()).toEqual([{ kind: "analysis_card", card: manual }]);
  });

  it("keeps history when the server does not confirm erasure", async () => {
    const uploaded = card("uploaded-report");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    vi.spyOn(console, "debug").mockImplementation(() => {});

    await expect(deletePersonalData()).rejects.toThrow();

    expect(loadReportHistory()).toEqual([{ kind: "analysis_card", card: uploaded }]);
  });
});

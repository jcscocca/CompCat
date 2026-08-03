// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import type { AnalysisReport, LayerKey, TrendsResponse } from "../types";
import { buildPrintableHtml, buildReportPackageFiles, createStoredZip, csvCell, decodeReportFile, reportFilename, trendCsvBlob, trendFilename } from "./reportExport";

function fixture(layer: LayerKey = "reported"): AnalysisReport {
  const source = layer === "reported" ? "seattle_spd_crime" : layer === "arrests" ? "seattle_spd_arrests" : "seattle_spd_911";
  const unit = layer === "reported" ? "reported_offense_record" : layer === "arrests" ? "arrest_record" : "deduplicated_cad_event";
  const subtype = layer === "reported" ? "offense_subcategory" : layer === "arrests" ? "arrest_offense_description" : "call_type";
  const title = layer === "reported" ? "Reported Incident Context Report" : layer === "arrests" ? "Arrest Activity Report" : "911 Call Activity Report";
  const report = {
    report_id: "report-1", schema_version: "1.0", method_version: "analysis-report-v1",
    profile: {
      profile_version: "1.0", layer, report_title: title, source_dataset: source, counting_unit: unit,
      counting_unit_label: unit, record_noun_singular: "record", record_noun_plural: "records",
      primary_time_field: "primary_time", primary_time_label: "Primary time", secondary_time_field: null, secondary_time_label: null,
      subtype_field: subtype, subtype_label: subtype.replaceAll("_", " "), supported_filters: [],
      capabilities: { reference_context: layer === "reported", modeled_comparison: layer === "reported", contextual_trend: false },
      disclosures: ["Records do not establish personal presence."],
    },
    selection_kind: "multi_place", comparison_mode: layer === "reported" ? "modeled" : "descriptive", status: "complete", generated_at: "2026-08-02T18:00:00Z",
    scope: { layer, source_dataset: source, counting_unit: unit, requested_start_date: "2025-01-01", requested_end_date: "2025-12-31", effective_start_date: "2025-01-01", effective_end_date: "2025-12-31", available_start_date: "2008-01-01", latest_recorded_event_date: "2025-12-30", latest_row_ingested_at: "2026-01-02T00:00:00Z", confirmed_data_through: null, radius_m: 250, filters: { offense_category: null, offense_subcategory: null, arrest_offense_description: null, call_type: null, nibrs_group: null } },
    selection: [
      { selection_id: "selection-1", label: "=HYPERLINK(\"bad\")", latitude: 47.6, longitude: -122.332 },
      { selection_id: "selection-2", label: "Second <script>alert(1)</script>", latitude: 47.61, longitude: -122.33 },
    ],
    sections: {
      overview: { counting_unit: unit, unique_counting_basis: "unique_source_records", membership_counting_basis: "per_place_membership", unique_source_record_count: 3, membership_count: 4, returned_record_count: 2, record_limit: 100, records_truncated: false },
      place_context: ["selection-1", "selection-2"].map((selection_id, index) => ({ selection_id, label: index ? "Second <script>alert(1)</script>" : "=HYPERLINK(\"bad\")", counting_unit: unit, counting_basis: "per_place_membership", record_count: 2, type_mix: [{ counting_unit: unit, counting_basis: "per_place_membership", label: index ? "Other" : "+SUM(1,1)", count: 2, share: 1 }], temporal: { counting_unit: unit, counting_basis: "per_place_membership", hour_counts: Array(24).fill(0), dow_counts: [1, 0, 0, 0, 1, 0, 0], monthly_counts: { "2025-01": 2 }, with_primary_time: 2, without_primary_time: 0 }, coordinate_coverage: null, reference_context: layer === "reported" ? [{ counting_unit: unit, counting_basis: "per_place_membership", kind: "beat", label: "Beat reference", available: true, adequacy_status: "adequate", sampling_frame: "beat", sampling_frame_version: "1", computation: null, geography_components: [], reference_center_count: 10, reference_draw_count: 100, monte_carlo_error: null, covered_area_share: 1, effective_geographies: 1, target_count: 2, p10: 0, p25: 1, median: 2, p75: 3, p90: 4, share_below: .4, share_equal: .1, share_above: .5, midrank_percentile: .45, warnings: [] }] : [] })),
      comparison: layer === "reported" ? { counting_unit: unit, counting_basis: "per_place_membership", method_family: "candidate_vs_alternatives_bh", decision_class: "no_clear_difference", summary_text: "No clear modeled difference.", caveat_text: "Context only.", options: [], pairwise_results: [{ counting_unit: unit, counting_basis: "per_place_membership", selection_a_id: "selection-1", selection_a_label: "First", selection_b_id: "selection-2", selection_b_label: "Second", decision_class: "no_clear_difference", method: "quasipoisson", record_count_a: 2, record_count_b: 2, rate_a: 1, rate_b: 1, rate_ratio: 1, ci_lower: .5, ci_upper: 2, p_value: .8, adjusted_p_value: .8, overdispersion_phi: 1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "Context only." }] } : null,
      records: { counting_unit: unit, counting_basis: "per_place_membership", total_membership_count: 2, returned_count: 2, limit: 100, truncated: false, records: [{ selection_id: "selection-1", place_label: "=HYPERLINK(\"bad\")", counting_unit: unit, counting_basis: "per_place_membership", source_dataset: source, primary_time: "2025-01-02T10:00:00Z", secondary_time: null, offense_category: layer === "calls" ? null : "THEFT", offense_subcategory: layer === "reported" ? "PROPERTY" : null, arrest_offense_description: layer === "arrests" ? "DESCRIPTION" : null, call_type: layer === "calls" ? "DISTURBANCE" : null, nibrs_group: null, distance_m: 42, duplicate_across_places: false }] },
    },
    section_statuses: [], disclosures: ["Records do not establish personal presence."],
    export_policy: { artifact_coordinate_decimals: 3, exact_coordinates_in_artifact: false, includes_owner_hash: false, includes_internal_place_ids: false, persisted_server_side: true, privacy_policy_checked_at: "2026-08-02T18:00:00Z", download_revalidation: "block_if_saved_place_deleted_or_sensitive" },
  };
  return report as AnalysisReport;
}

describe("report exports", () => {
  const trendMonths = Array.from({ length: 13 }, (_, index) => {
    const date = new Date(Date.UTC(2025, index, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  });
  const trend: TrendsResponse = {
    layer: "reported",
    mcpp: "PIONEER SQUARE",
    mcpp_label: "Pioneer Square",
    category: null,
    months: trendMonths,
    area_counts: [1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 3],
    citywide_counts: [10, 9, 11, 8, 10, 9, 12, 8, 10, 9, 11, 8, 13],
  };

  it("neutralizes spreadsheet formulas only for strings", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("-42")).toBe("'-42");
    expect(csvCell(-42)).toBe("-42");
  });

  it("builds the full reported package with checksums and safe CSV cells", async () => {
    const files = await buildReportPackageFiles(fixture());
    expect(Object.keys(files).sort()).toEqual([
      "comparison.csv", "metadata.json", "overview.csv", "places.csv", "printable.html",
      "records.csv", "reference_context.csv", "report.json", "temporal.csv", "type_mix.csv",
    ]);
    const selectedLocationHeaders = "schema_version,method_version,selected_location,selected_location_latitude_generalized,selected_location_longitude_generalized,selected_radius_m";
    for (const name of ["overview.csv", "places.csv", "type_mix.csv", "temporal.csv", "records.csv", "reference_context.csv", "comparison.csv"]) {
      expect(decodeReportFile(files[name]).split("\r\n")[0]).toContain(selectedLocationHeaders);
    }
    expect(decodeReportFile(files["places.csv"])).toContain("'=HYPERLINK");
    const metadata = JSON.parse(decodeReportFile(files["metadata.json"]));
    expect(metadata).toMatchObject({
      selected_location: "=HYPERLINK(\"bad\")",
      selected_location_latitude_generalized: 47.6,
      selected_location_longitude_generalized: -122.332,
      selected_radius_m: 250,
    });
    expect(metadata.selected_locations).toEqual([
      { selection_id: "selection-1", label: "=HYPERLINK(\"bad\")", latitude_generalized: 47.6, longitude_generalized: -122.332 },
      { selection_id: "selection-2", label: "Second <script>alert(1)</script>", latitude_generalized: 47.61, longitude_generalized: -122.33 },
    ]);
    expect(Object.keys(metadata.checksums_sha256).sort()).toEqual(Object.keys(files).filter((name) => name !== "metadata.json").sort());
    expect(Object.values(metadata.checksums_sha256).every((value) => /^[a-f0-9]{64}$/.test(String(value)))).toBe(true);
    const zip = createStoredZip(files);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect([...zip.slice(-22, -18)]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("omits reported-only tables for descriptive call reports", async () => {
    const files = await buildReportPackageFiles(fixture("calls"));
    expect(files["comparison.csv"]).toBeUndefined();
    expect(files["reference_context.csv"]).toBeUndefined();
    expect(decodeReportFile(files["records.csv"]).split("\r\n")[0]).toContain("call_type");
  });

  it("exports broader-neighborhood trend values only through report exports", async () => {
    const report = fixture();
    const files = await buildReportPackageFiles(report, [trend]);
    const csv = decodeReportFile(files["neighborhood_trends.csv"]);
    expect(csv).toContain("selected_location,selected_location_latitude_generalized,selected_location_longitude_generalized,selected_radius_m,context_scope,layer");
    expect(csv).toContain(",47.6,-122.332,250,broader_neighborhood_outside_selected_radius,reported,,PIONEER SQUARE,Pioneer Square,2026-01,3,");
    expect(csv.split("\r\n")).toHaveLength(15);
    expect(trendFilename(report, trend)).toBe("compcat-reported-hyperlink-bad-pioneer-square-neighborhood-trend-2026-08-02.csv");
    expect(await trendCsvBlob(report, trend).text()).toBe(csv);
  });

  it("escapes user-controlled printable HTML and contains no executable script", () => {
    const html = buildPrintableHtml(fixture());
    expect(html).toContain("Primary selected location: =HYPERLINK(&quot;bad&quot;)");
    expect(html).toContain("generalized coordinates 47.600, -122.332");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("owner_hash");
    expect(reportFilename(fixture(), "zip")).toBe("compcat-reported-hyperlink-bad-plus-1-report-2026-08-02.zip");
  });
});

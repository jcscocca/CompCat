import type { Page } from "@playwright/test";
import { Buffer } from "node:buffer";

import type { AnalysisReport } from "../../src/types";

const JSON_HEADERS = { "content-type": "application/json" };

const emptySummary = {
  totals: { place_count: 0, visit_count: 0, incident_count: 0 },
  privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
  places: [],
  crime_summaries: [],
  analysis: { available_radii_m: [250, 500, 1000] },
  exports: {
    tableau_place_summary_csv: "/exports/tableau/place-summary.csv",
    analysis_csv: "/exports/analysis.csv",
  },
};

const freshness = {
  reported: {
    incident_count: 386,
    earliest: "2018-01-01",
    data_through: "2025-10-31",
    last_ingested_at: "2026-08-10T12:00:00Z",
  },
  arrests: {
    incident_count: 120,
    earliest: "2023-01-01",
    data_through: "2025-10-31",
    last_ingested_at: "2026-08-10T12:00:00Z",
  },
  calls: {
    incident_count: 240,
    earliest: "2023-01-01",
    data_through: "2025-10-31",
    last_ingested_at: "2026-08-10T12:00:00Z",
  },
};

const incidentPoints = {
  points: [],
  returned_count: 0,
  total_count: 0,
  returned_location_count: 0,
  total_location_count: 0,
  layer_totals: { reported: 0, arrests: 0, calls: 0 },
  unmappable_citywide_count: 0,
  limit: 5000,
};

const areaSummary = {
  selection_id: "visual-area",
  record_count: 18,
  location_count: 11,
  counting_basis: "records with mappable coordinates inside the selected area",
  type_mix: [
    { label: "THEFT", count: 9, share: 0.5 },
    { label: "ASSAULT", count: 5, share: 0.278 },
    { label: "BURGLARY", count: 4, share: 0.222 },
  ],
  temporal: {
    hour_counts: Array.from({ length: 24 }, (_, hour) => (hour === 12 ? 5 : hour === 18 ? 4 : hour % 5 === 0 ? 1 : 0)),
    dow_counts: [2, 4, 1, 3, 2, 4, 2],
    hour_by_dow: Array.from({ length: 7 }, () => Array(24).fill(0)),
    total_with_time: 18,
    without_time: 0,
  },
  highlight_mode: "locations",
  highlight_points: [],
  highlight_location_count: 11,
};

const areaRecords = {
  selection_id: "visual-area",
  returned_count: 1,
  page_size: 50,
  next_cursor: null,
  records: [{
    incident_id: "visual-record",
    external_incident_id: null,
    report_number: "R-100",
    occurred_at: "2025-04-12T12:00:00-07:00",
    reported_at: null,
    offense_category: "PROPERTY",
    offense_subcategory: "THEFT",
    nibrs_group: null,
    block_address: "100 BLOCK OF PINE ST",
    latitude: 47.61,
    longitude: -122.33,
    source_dataset: "seattle_spd_crime",
  }],
};

const sharedReport: AnalysisReport = {
  report_id: null,
  schema_version: "1.1",
  method_version: "analysis-report-v1",
  profile: {
    profile_version: "1.0",
    layer: "reported",
    report_title: "Reported Incident Context Report",
    source_dataset: "seattle_spd_crime",
    counting_unit: "reported_offense_record",
    counting_unit_label: "Reported-offense record",
    record_noun_singular: "reported incident record",
    record_noun_plural: "reported incident records",
    primary_time_field: "occurred_at",
    primary_time_label: "Recorded time",
    secondary_time_field: null,
    secondary_time_label: null,
    subtype_field: "offense_subcategory",
    subtype_label: "Offense subcategory",
    supported_filters: [],
    capabilities: { reference_context: true, modeled_comparison: true, contextual_trend: false },
    disclosures: ["Reported records do not establish personal presence or personal risk."],
  },
  selection_kind: "single_place",
  comparison_mode: "none",
  status: "complete",
  generated_at: "2026-08-10T12:00:00Z",
  scope: {
    layer: "reported",
    source_dataset: "seattle_spd_crime",
    counting_unit: "reported_offense_record",
    requested_start_date: "2025-01-01",
    requested_end_date: "2025-10-27",
    effective_start_date: "2025-01-01",
    effective_end_date: "2025-10-27",
    available_start_date: "2008-01-01",
    latest_recorded_event_date: "2025-10-27",
    latest_row_ingested_at: "2026-08-10T12:00:00Z",
    confirmed_data_through: null,
    radius_m: 250,
    filters: {
      offense_category: null,
      offense_subcategory: null,
      arrest_offense_description: null,
      call_type: null,
      nibrs_group: null,
    },
  },
  selection: [{
    selection_id: "selection-1",
    label: "Downtown audit point",
    latitude: 47.6005,
    longitude: -122.3315,
  }],
  sections: {
    overview: {
      counting_unit: "reported_offense_record",
      unique_counting_basis: "unique_source_records",
      membership_counting_basis: "per_place_membership",
      unique_source_record_count: 8,
      membership_count: 8,
      overlap_summary: {
        shared_source_record_count: 0,
        additional_membership_count: 0,
        maximum_places_per_record: 1,
      },
      returned_record_count: 0,
      record_limit: 100,
      records_truncated: false,
    },
    place_context: [{
      selection_id: "selection-1",
      label: "Downtown audit point",
      counting_unit: "reported_offense_record",
      counting_basis: "per_place_membership",
      record_count: 8,
      type_mix: [
        { counting_unit: "reported_offense_record", counting_basis: "per_place_membership", label: "Theft", count: 5, share: 0.625 },
        { counting_unit: "reported_offense_record", counting_basis: "per_place_membership", label: "Assault", count: 3, share: 0.375 },
      ],
      temporal: {
        counting_unit: "reported_offense_record",
        counting_basis: "per_place_membership",
        hour_counts: Array(24).fill(0),
        dow_counts: [2, 1, 1, 1, 1, 1, 1],
        monthly_counts: { "2025-01": 3, "2025-04": 2, "2025-10": 3 },
        with_primary_time: 8,
        without_primary_time: 0,
      },
      coordinate_coverage: null,
      reference_context: [],
    }],
    comparison: null,
    records: {
      counting_unit: "reported_offense_record",
      counting_basis: "per_place_membership",
      total_membership_count: 8,
      returned_count: 0,
      limit: 100,
      truncated: false,
      records: [],
    },
  },
  section_statuses: [],
  disclosures: ["Reported records do not establish personal presence or personal risk."],
  export_policy: {
    artifact_coordinate_decimals: 3,
    exact_coordinates_in_artifact: false,
    includes_owner_hash: false,
    includes_internal_place_ids: false,
    persisted_server_side: false,
    privacy_policy_checked_at: "2026-08-10T12:00:00Z",
    download_revalidation: "block_if_saved_place_deleted_or_sensitive",
  },
};

/** Keep browser screenshots deterministic without introducing a test-only path in the app. */
export async function mockEmptyDashboard(
  page: Page,
  theme: "light" | "dark" = "dark",
  mobileSnap: "bar" | "half" | "full" = "half",
): Promise<void> {
  await page.addInitScript(({ initialTheme, initialSnap }) => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.localStorage.setItem("compcat.theme", initialTheme);
    window.localStorage.setItem("compcat.drawer.collapsed", String(initialSnap === "bar"));
    window.localStorage.setItem("compcat.drawer.snap", initialSnap);
  }, { initialTheme: theme, initialSnap: mobileSnap });
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body: unknown, status = 200) => route.fulfill({
      status,
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    });

    if (path === "/sessions" && request.method() === "POST") {
      await json({ session_state: "created" });
    } else if (path === "/dashboard/summary") {
      await json(emptySummary);
    } else if (path === "/dashboard/freshness") {
      await json(freshness);
    } else if (path === "/input-modes") {
      await json({ modes: [{ id: "manual_places" }, { id: "bulk_places" }] });
    } else if (path === "/dashboard/beats") {
      await json({ type: "FeatureCollection", features: [] });
    } else if (path === "/dashboard/incident-points") {
      await json(incidentPoints);
    } else if (path === "/dashboard/area-selection/summary") {
      await json(areaSummary);
    } else if (path === "/dashboard/area-selection/records") {
      await json(areaRecords);
    } else if (path === "/dashboard/reports") {
      await json(sharedReport);
    } else if (path === "/dashboard/incidents") {
      await json({ incidents: [], returned_count: 0, total_count: 8, limit: 100, radius_m: 250 });
    } else if (path === "/dashboard/neighborhood") {
      await json({
        radius_m: 250,
        analysis_start_date: "2025-01-01",
        analysis_end_date: "2025-10-27",
        offense_category: null,
        places: [],
        pairwise: [],
      });
    } else if (path.startsWith("/tiles/")) {
      await route.fulfill({ status: 404, body: "" });
    } else {
      await route.continue();
    }
  });
}

export async function waitForSharedReport(page: Page): Promise<void> {
  const view = Buffer.from(JSON.stringify({
    v: 1,
    t: "analyze",
    r: 250,
    s: "2025-01-01",
    e: "2025-10-27",
    ly: "reported",
    pts: [{ y: 47.6005, x: -122.3315, l: "Downtown audit point" }],
    c: null,
  })).toString("base64url");
  await page.goto(`/?view=${view}`);
  await page.getByRole("heading", { name: "Reported Incident Context Report" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
}

export async function waitForStableDashboard(page: Page, panelExpected = true): Promise<void> {
  await page.goto("/");
  await page.getByRole("heading", {
    name: "CompCat — reported Seattle incident context around addresses",
  }).waitFor();
  await page.getByRole("button", {
    name: "Reported incidents — 0 in current map view",
  }).waitFor();
  if (panelExpected) await page.getByRole("heading", { name: "Let’s start with a place" }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({
    content: [
      "*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }",
      ".maplibregl-canvas { visibility: hidden !important; }",
    ].join("\n"),
  });
}

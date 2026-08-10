// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Captures each distinct flyTo reference MapCanvas receives — the real MapCanvas re-flies
// on reference change, so the capture list mirrors the fly sequence the map would perform.
const flyToCaptures = vi.hoisted(() => [] as ({ lat: number; lng: number } | null)[]);
// Mirrors flyToCaptures for the fit-on-analysis prop: pushes each distinct fitTo reference
// MapCanvas receives, so tests can assert the camera-fit points + padding.
const fitToCaptures = vi.hoisted(() => [] as unknown[]);
// Captures the places + selectedIds MapCanvas receives each render, so tests can assert the
// synthetic ad-hoc pins MapWorkspace appends (mirrors the flyToCaptures pattern above).
const canvasCaptures = vi.hoisted(() => [] as { places: unknown[]; selectedIds: Set<string> }[]);
vi.mock("./MapCanvas", () => ({
  MapCanvas: ({ places, selectedIds, draft, flyTo, fitTo, badgedPlaceIds, onViewportChange, onMapClick, onMarkerClick, onBadgeClick }: any) => {
    if (flyToCaptures[flyToCaptures.length - 1] !== flyTo) flyToCaptures.push(flyTo);
    if (fitToCaptures[fitToCaptures.length - 1] !== fitTo) fitToCaptures.push(fitTo);
    canvasCaptures.push({ places, selectedIds });
    return (
      <div data-testid="mapcanvas">
        <button data-testid="fire-map-click" onClick={() => onMapClick({ lat: 47.6, lng: -122.3 })} />
        {/* The real canvas reports a viewport on load/moveend; the incident-dot layer holds
            off fetching until it does. */}
        <button
          data-testid="fire-viewport"
          onClick={() => onViewportChange?.({ west: -122.4, south: 47.55, east: -122.25, north: 47.65 })}
        />
        {draft ? <div data-testid="draft-pin" /> : null}
        {places.map((place: any) => (
          <span key={place.id}>
            <button data-testid={`marker-${place.id}`} onClick={() => onMarkerClick(place.id)} />
            {badgedPlaceIds?.has(place.id) ? (
              <button data-testid={`badge-${place.id}`} onClick={() => onBadgeClick(place.id)} />
            ) : null}
          </span>
        ))}
      </div>
    );
  },
}));

// The status->copy helpers (friendlyMessageOr, SESSION_EXPIRED_MESSAGE) are pure and are
// exactly what the error surfaces are asserted on, so keep the real ones and fake only the
// network calls.
vi.mock("../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/client")>()),
  analyzePlaces: vi.fn(),
  comparePlaces: vi.fn(),
  createAnalysisReport: vi.fn(),
  createBulkPlaces: vi.fn(),
  createPlace: vi.fn(),
  createSession: vi.fn(),
  deleteAllPlaces: vi.fn(),
  deletePlace: vi.fn(),
  getBeatPolygons: vi.fn().mockResolvedValue({ type: "FeatureCollection", features: [] }),
  getIncidentDetails: vi.fn(),
  getIncidentPoints: vi.fn().mockResolvedValue({
    points: [], returned_count: 0, total_count: 0, returned_location_count: 0,
    total_location_count: 0, layer_totals: { reported: 0, arrests: 0, calls: 0 },
    unmappable_citywide_count: 0, limit: 5000,
  }),
  getNeighborhoodAnalysis: vi.fn(),
  getDashboardSummary: vi.fn(),
  getDashboardFreshness: vi.fn().mockResolvedValue(null),
  getInputModes: vi.fn().mockResolvedValue({ modes: [] }),
  streamAssistantChat: vi.fn(),
  streamAssistantCommand: vi.fn(),
  updatePlace: vi.fn(),
}));

const geocodeSearch = vi.hoisted(() => vi.fn());
vi.mock("../lib/geocoding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/geocoding")>()),
  geocodingProvider: { search: geocodeSearch },
}));

import { MapWorkspace } from "./MapWorkspace";
import { analyzePlaces, comparePlaces, createAnalysisReport, createBulkPlaces, createPlace, createSession, deleteAllPlaces, deletePlace, getBeatPolygons, getDashboardFreshness, getDashboardSummary, getIncidentDetails, getNeighborhoodAnalysis, streamAssistantChat, streamAssistantCommand, updatePlace } from "../api/client";
import { getIncidentPoints, SESSION_EXPIRED_MESSAGE } from "../api/client";
import { assertValidPlaceCreate } from "../api/placeCreateContract";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import { snapHeightPx } from "../lib/drawer";
import { decodeView, encodeView } from "../lib/savedView";
import { keyOf } from "../lib/useAddressList";
import type { AnalysisReport, AnalysisReportRequest, DashboardFreshness, DashboardSummary, IncidentDetailsResponse, NeighborhoodAnalysis, Place, SiteComparison } from "../types";

const home: Place = {
  id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};
const work: Place = {
  id: "p2", display_label: "Work", latitude: 47.62, longitude: -122.34, visit_count: 3,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};
const pin9: Place = {
  id: "p9", display_label: "Pin 9", latitude: 47.6, longitude: -122.3, visit_count: 1,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};

function makeSummary(places: Place[] = []): DashboardSummary {
  return {
    totals: { place_count: places.length, visit_count: 0, incident_count: 0 },
    privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
    places,
    crime_summaries: [],
    analysis: { available_radii_m: [250, 500, 1000] },
    exports: { tableau_place_summary_csv: "/exports/current.csv" },
  };
}

function makeIncidentDetails(): IncidentDetailsResponse {
  return {
    incidents: [
      {
        place_id: "p1",
        place_label: "Home",
        incident_id: "incident-1",
        external_incident_id: null,
        report_number: "R-100",
        occurred_at: "2026-01-02T10:00:00Z",
        reported_at: null,
        offense_category: null,
        offense_subcategory: "THEFT",
        nibrs_group: "A",
        block_address: "100 BLOCK MAIN ST",
        distance_m: 42.4,
      },
    ],
    returned_count: 1,
    total_count: 1,
    limit: 100,
    radius_m: 250,
  };
}

function makeNeighborhoodAnalysis(): NeighborhoodAnalysis {
  return {
    radius_m: 250,
    analysis_start_date: "2026-01-01",
    analysis_end_date: "2026-06-30",
    offense_category: null,
    places: [],
    pairwise: [],
  };
}

function makeAnalysisReport(payload: AnalysisReportRequest): AnalysisReport {
  const selected = payload.points ?? (payload.place_ids ?? []).map((id) => {
    const place = [home, work, pin9].find((item) => item.id === id) ?? home;
    return { latitude: place.latitude as number, longitude: place.longitude as number, label: place.display_label };
  });
  const layer = payload.layer;
  const profileByLayer = {
    reported: { title: "Reported Incident Context Report", unit: "reported_offense_record", unitLabel: "Reported-offense record", singular: "reported incident record", plural: "reported incident records", source: "seattle_spd_crime", subtype: "offense_subcategory", subtypeLabel: "Offense subcategory" },
    arrests: { title: "Arrest Activity Report", unit: "arrest_record", unitLabel: "Arrest record", singular: "arrest record", plural: "arrest records", source: "seattle_spd_arrests", subtype: "arrest_offense_description", subtypeLabel: "Arrest offense description" },
    calls: { title: "911 Call Activity Report", unit: "deduplicated_cad_event", unitLabel: "Deduplicated CAD event", singular: "911 call event", plural: "911 call events", source: "seattle_spd_911", subtype: "call_type", subtypeLabel: "Call type" },
  }[layer];
  const selections = selected.map((point, index) => ({ selection_id: `selection-${index + 1}`, label: point.label, latitude: point.latitude, longitude: point.longitude }));
  return {
    report_id: payload.place_ids ? "report-test" : null,
    schema_version: "1.0", method_version: "analysis-report-v1",
    profile: {
      profile_version: "1.0", layer, report_title: profileByLayer.title, source_dataset: profileByLayer.source,
      counting_unit: profileByLayer.unit, counting_unit_label: profileByLayer.unitLabel,
      record_noun_singular: profileByLayer.singular, record_noun_plural: profileByLayer.plural,
      primary_time_field: "occurred_at", primary_time_label: "Recorded time", secondary_time_field: null, secondary_time_label: null,
      subtype_field: profileByLayer.subtype, subtype_label: profileByLayer.subtypeLabel,
      supported_filters: [], capabilities: { reference_context: layer === "reported", modeled_comparison: layer === "reported", contextual_trend: false }, disclosures: ["Records do not establish personal presence or personal risk."],
    },
    selection_kind: selections.length > 1 ? "multi_place" : "single_place",
    comparison_mode: selections.length < 2 ? "none" : layer === "reported" ? "modeled" : "descriptive",
    status: "complete", generated_at: "2026-08-02T18:00:00Z",
    scope: {
      layer, source_dataset: profileByLayer.source, counting_unit: profileByLayer.unit,
      requested_start_date: payload.analysis_start_date, requested_end_date: payload.analysis_end_date,
      effective_start_date: payload.analysis_start_date, effective_end_date: payload.analysis_end_date,
      available_start_date: "2008-01-01", latest_recorded_event_date: payload.analysis_end_date,
      latest_row_ingested_at: "2026-08-02T17:00:00Z", confirmed_data_through: null, radius_m: payload.radius_m,
      filters: { offense_category: payload.offense_category ?? null, offense_subcategory: payload.offense_subcategory ?? null, arrest_offense_description: payload.arrest_offense_description ?? null, call_type: payload.call_type ?? null, nibrs_group: payload.nibrs_group ?? null },
    },
    selection: selections,
    sections: {
      overview: { counting_unit: profileByLayer.unit, unique_counting_basis: "unique_source_records", membership_counting_basis: "per_place_membership", unique_source_record_count: selections.length * 3, membership_count: selections.length * 3, returned_record_count: 0, record_limit: 100, records_truncated: false },
      place_context: selections.map((selection) => ({ selection_id: selection.selection_id, label: selection.label, counting_unit: profileByLayer.unit, counting_basis: "per_place_membership", record_count: 3, type_mix: [], temporal: { counting_unit: profileByLayer.unit, counting_basis: "per_place_membership", hour_counts: Array(24).fill(0), dow_counts: Array(7).fill(0), monthly_counts: {}, with_primary_time: 0, without_primary_time: 3 }, coordinate_coverage: null, reference_context: [] })),
      comparison: selections.length > 1 && layer === "reported" ? { counting_unit: profileByLayer.unit, counting_basis: "per_place_membership", method_family: "candidate_vs_alternatives_bh", decision_class: "descriptive_only", summary_text: "The modeled comparison is shown with its stated limits.", caveat_text: "Reported records are contextual evidence.", options: [], pairwise_results: [] } : null,
      records: { counting_unit: profileByLayer.unit, counting_basis: "per_place_membership", total_membership_count: selections.length * 3, returned_count: 0, limit: 100, truncated: false, records: [] },
    },
    section_statuses: [], disclosures: ["Records do not establish personal presence or personal risk."],
    export_policy: { artifact_coordinate_decimals: 3, exact_coordinates_in_artifact: false, includes_owner_hash: false, includes_internal_place_ids: false, persisted_server_side: Boolean(payload.place_ids), privacy_policy_checked_at: "2026-08-02T18:00:00Z", download_revalidation: "block_if_saved_place_deleted_or_sensitive" },
  };
}

function makeSiteComparison(aLabel: string, bLabel: string): SiteComparison {
  const opt = (id: string, label: string, count: number, rate: number) => ({ id, label, geometry_type: "place_buffer", radius_m: 250, incident_count: count, exposure: 1, exposure_unit: "square_km_days", incident_rate: rate });
  const options = [opt("a", aLabel, 12, 3.9), opt("b", bLabel, 44, 14.3)];
  return {
    id: "c1", comparison_type: "site", geometry_type: "place_buffer", radius_m: 250,
    analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
    offense_category: null, offense_subcategory: null, nibrs_group: null, created_at: "2026-07-03",
    overview: { label: "Overview", decision_class: "statistically_lower", recommendation_option_id: "a", recommendation_label: aLabel, summary_text: "", caveat_text: "cav", options },
    analytical: { label: "Analytical", source_dataset: "seattle_spd_crime", exposure_unit: "square_km_days", full_caveat_text: "full cav", options, pairwise_results: [{ id: "a-b", option_a_id: "a", option_a_label: aLabel, option_b_id: "b", option_b_label: bLabel, winner_option_id: "a", winner_label: aLabel, decision_class: "statistically_lower", method: "quasipoisson", incident_count_a: 12, incident_count_b: 44, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days", rate_a: 3.9, rate_b: 14.3, rate_ratio: 3.9 / 14.3, ci_lower: 0.15, ci_upper: 0.5, p_value: 0.001, adjusted_p_value: 0.004, overdispersion_phi: 1.1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "" }] },
  };
}

beforeEach(() => {
  // Clear the stored theme and the document attribute so the toggle test
  // doesn't inherit prior-test state; clear all storage so the persisted
  // `compcat.selection` key never leaks between tests.
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  // jsdom has no scrollIntoView; the rail's focus-card effect calls it. Fresh stub per test.
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(getDashboardFreshness).mockResolvedValue(null as unknown as DashboardFreshness);
  vi.mocked(createAnalysisReport).mockImplementation(async (payload) => makeAnalysisReport(payload));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.removeItem("compcat.theme");
  sessionStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  window.innerWidth = 1024;
  // A ?view= URL or captured fly sequence must never leak into the next test, even when
  // an assertion fails before a test's own cleanup lines run.
  window.history.replaceState(null, "", "/");
  flyToCaptures.length = 0;
  fitToCaptures.length = 0;
  canvasCaptures.length = 0;
});

describe("MapWorkspace", () => {
  it("waits for session creation before authenticated bootstrap requests", async () => {
    let resolveSession!: (value: { session_state: string }) => void;
    vi.mocked(createSession).mockReturnValue(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    render(<MapWorkspace />);

    expect(getDashboardSummary).not.toHaveBeenCalled();
    expect(getDashboardFreshness).not.toHaveBeenCalled();
    expect(getBeatPolygons).not.toHaveBeenCalled();

    await act(async () => {
      resolveSession({ session_state: "created" });
    });

    await waitFor(() => {
      expect(getDashboardSummary).toHaveBeenCalledTimes(1);
      expect(getDashboardFreshness).toHaveBeenCalledTimes(1);
      expect(getBeatPolygons).toHaveBeenCalledTimes(1);
    });
  });

  it("defaults to the freshest loaded year and disables layers with no rows", async () => {
    localStorage.setItem("compcat.selection", JSON.stringify([home.id]));
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getDashboardFreshness).mockResolvedValue({
      reported: { incident_count: 386, earliest: "2018-01-01", data_through: "2025-10-27", last_ingested_at: "2026-07-20" },
      arrests: { incident_count: 0, earliest: null, data_through: null, last_ingested_at: null },
      calls: { incident_count: 0, earliest: null, data_through: null, last_ingested_at: null },
    });

    render(<MapWorkspace />);

    await waitFor(() => expect(analyzePlaces).toHaveBeenCalledWith(expect.objectContaining({
      analysis_start_date: "2025-01-01",
      analysis_end_date: "2025-10-27",
    })));
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Data layer: Reported incidents" }));
    expect(screen.getByRole("button", { name: "Arrests — No data loaded" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "911 calls — No data loaded" })).toBeDisabled();
  });

  it("uses header actions for desktop width and collapse, then restores the prior width", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    const { container } = render(<MapWorkspace />);
    await screen.findByText("Home");
    const panel = () => container.querySelector(".mc-workspace-panel") as HTMLElement;

    expect(screen.queryByRole("group", { name: "Panel size" })).not.toBeInTheDocument();
    const widenButton = screen.getByRole("button", { name: "Use wide pane width" });
    expect(widenButton).toHaveTextContent("Widen");
    expect(screen.getByRole("button", { name: "Collapse Tabby pane" })).toHaveTextContent("Hide");
    fireEvent.click(widenButton);
    expect(panel().style.width).toBe("640px");
    expect(screen.getByRole("button", { name: "Use default pane width" })).toHaveTextContent("Standard");
    expect(screen.getByRole("button", { name: "Use default pane width" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Collapse Tabby pane" }));
    expect(panel()).toHaveClass("is-collapsed");
    const restore = container.querySelector(".mc-pane-tab") as HTMLButtonElement;
    expect(restore).toHaveAccessibleName("Expand Tabby pane");
    fireEvent.click(restore);
    expect(panel()).toHaveClass("is-open");
    expect(panel().style.width).toBe("640px");
  });

  it("theme toggle flips the document theme attribute", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);
    await screen.findByText("Home");

    const toggle = await screen.findByRole("button", { name: /switch to (dark|light) theme/i });
    const before = document.documentElement.getAttribute("data-theme");
    fireEvent.click(toggle);
    await waitFor(() => {
      const after = document.documentElement.getAttribute("data-theme");
      expect(after).toMatch(/dark|light/);
      expect(after).not.toBe(before);
    });
  });

  it("starts a session and lists returned places", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText("CompCat")).toBeInTheDocument();
  });

  it("drops a pin from a map click and saves it", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValueOnce(makeSummary([home]));
    vi.mocked(createPlace).mockResolvedValue(home);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));

    await waitFor(() => {
      expect(createPlace).toHaveBeenCalledWith({
        display_label: "Pin at 47.600000, -122.300000",
        latitude: 47.6,
        longitude: -122.3,
        visit_count: 1,
        sensitivity_class: "normal",
      });
    });
  });

  it("lets a newly saved pin run a report without going through Tabby", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValue(makeSummary([home]));
    vi.mocked(createPlace).mockResolvedValue(home);
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());

    const { container } = render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Home" } });
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));

    // The saved pin lands in the one address list as a selected (saved) entry. The
    // offer-bearing add lands on the Tabby rail, so its chip renders in the rail's
    // topSlot, checked.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "true");
    });

    // A manual save waits for the user, then the report runs through dashboard APIs without
    // sending an assistant command.
    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));

    await waitFor(() => expect(analyzePlaces).toHaveBeenCalled());
    expect(analyzePlaces).toHaveBeenCalledWith(expect.objectContaining({
      place_ids: ["p1"],
      radii_m: [250],
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
      layer: "reported",
    }));
    expect(streamAssistantCommand).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: "View details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Collapse" })).not.toBeInTheDocument();
    expect(document.querySelectorAll(".mc-result-card")).toHaveLength(1);
    expect((container.querySelector(".mc-workspace-panel") as HTMLElement).style.width).toBe("400px");
    expect(screen.queryByRole("button", { name: "Run report" })).not.toBeInTheDocument();
    expect(screen.queryByText("Tabby is using")).not.toBeInTheDocument();
    expect(screen.getByText("Report scope")).toBeInTheDocument();
    expect(screen.getByText("Ask Tabby about this report")).toBeInTheDocument();
    expect(screen.getByLabelText("Analyst message")).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByText("Analysis setup")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Search radius: 250 m" }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(screen.getByRole("button", { name: "Update report" })).toBeInTheDocument();
  });

  it("lets bulk imported places run a direct comparison report", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValue(makeSummary([home, work]));
    vi.mocked(createBulkPlaces).mockResolvedValue({ created_count: 2, skipped_count: 0, places: [home, work] });
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Home", "Work"));

    render(<MapWorkspace />);
    await screen.findByRole("button", { name: "Add places manually" });

    fireEvent.click(screen.getByRole("button", { name: /add places manually/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Paste list" }));
    fireEvent.change(screen.getByLabelText("Place rows (label, lat, lon)"), {
      target: { value: "display_label,latitude,longitude\nHome,47.61,-122.33\nWork,47.62,-122.34" },
    });
    fireEvent.click(screen.getByRole("button", { name: /import places/i }));

    expect(await screen.findByRole("checkbox", { name: "Select Home" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Select Work" })).toHaveAttribute("aria-checked", "true");

    // Importing waits for the user; the report then compares the selected points directly.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));

    await waitFor(() => expect(comparePlaces).toHaveBeenCalled());
    expect(comparePlaces).toHaveBeenCalledWith(expect.objectContaining({
      points: [
        expect.objectContaining({ label: "Home" }),
        expect.objectContaining({ label: "Work" }),
      ],
      radius_m: 250,
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
      layer: "reported",
    }));
    expect(streamAssistantCommand).not.toHaveBeenCalled();
  });

  it("closes the manage modal when its address search hands off to the draft flow", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    geocodeSearch.mockResolvedValue([{ label: "500 Pine St", latitude: 47.615, longitude: -122.335, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("button", { name: "Manage places" }));
    expect(screen.getByRole("dialog", { name: "Manage places" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "500 Pine" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByText("500 Pine St"));

    // The scrim would hide the draft editor, so the handoff must close the modal first.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The searched point hands off to the same desktop map editor as a dropped pin.
    expect(await screen.findByRole("button", { name: /save pin/i })).toBeInTheDocument();
  });

  it("surfaces a failed rename as an alert on the rail", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(updatePlace).mockRejectedValue(new Error("boom"));

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("button", { name: "Manage places" }));
    await screen.findByRole("dialog", { name: "Manage places" });
    fireEvent.click(screen.getByRole("button", { name: "Rename Home" }));
    const input = screen.getByRole("textbox", { name: "New name for Home" });
    fireEvent.change(input, { target: { value: "Home base" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The rejected rename surfaces on the rail's error line (role=alert), announced —
    // the retired Compare panel used to be the visible home for these strings.
    const alert = await screen.findByText("Unable to rename place. Try again.");
    expect(alert).toHaveAttribute("role", "alert");
    // The modal stays open and the place keeps its label.
    const dialog = screen.getByRole("dialog", { name: "Manage places" });
    expect(within(dialog).getByText("Home")).toBeInTheDocument();
  });

  it("marks the frame is-focus only when the drawer leaves less than the chrome minimum", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    try {
      // Default width (400) leaves a 624px strip at jsdom's 1024 viewport — chrome stays.
      const wide = render(<MapWorkspace />);
      await screen.findByText(/point me at a place/i);
      expect(wide.container.querySelector(".mc-frame")).not.toHaveClass("is-focus");
      wide.unmount();

      // A 900px drawer leaves a 124px strip (< FOCUS_CHROME_MIN 240) — chrome sheds.
      localStorage.setItem("compcat.drawer.width", "900");
      const focus = render(<MapWorkspace />);
      await screen.findByText(/point me at a place/i);
      expect(focus.container.querySelector(".mc-frame")).toHaveClass("is-focus");
    } finally {
      localStorage.removeItem("compcat.drawer.width");
      localStorage.removeItem("compcat.drawer.collapsed");
    }
  });

  it("narrow viewport does not enter desktop focus mode", async () => {
    window.innerWidth = 375;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    const { container } = render(<MapWorkspace />);
    await screen.findByText("Home");

    expect(container.querySelector(".mc-frame")?.classList.contains("is-focus")).toBe(false);
  });

  it("collapses the workspace panel while choosing where to drop a pin", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    const { container } = render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));

    expect(container.querySelector(".mc-frame")).toHaveClass("is-placing-pin");
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-collapsed");
    expect(container.querySelector(".mc-sheet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("fire-map-click"));

    expect(container.querySelector(".mc-frame")).not.toHaveClass("is-placing-pin");
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-open");
    const editor = screen.getByRole("form", { name: "Name this pin" });
    expect(editor.closest(".mc-draft-overlay")).not.toBeNull();
    expect(editor.closest(".mc-workspace-panel")).toBeNull();
    expect(screen.getByLabelText(/pin label/i)).toHaveFocus();
  });

  it("narrow viewport: arming add-pin drops the sheet to bar, and a map click raises it to half", async () => {
    window.innerWidth = 400;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    const { container } = render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-half");

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-bar");

    fireEvent.click(screen.getByTestId("fire-map-click"));
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-half");
    const editor = screen.getByRole("form", { name: "Name this pin" });
    expect(editor.closest(".mc-draft-inline")).not.toBeNull();
    expect(editor.closest(".mc-workspace-panel")).not.toBeNull();
    expect(container.querySelector(".mc-draft-overlay")).not.toBeInTheDocument();
  });

  it("narrow viewport: shows the compact map count only while the sheet is at the bar snap", async () => {
    window.innerWidth = 400;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(getIncidentPoints).mockResolvedValue({
      points: [], returned_count: 42, total_count: 42, returned_location_count: 18,
      total_location_count: 18, layer_totals: { reported: 42, arrests: 0, calls: 0 },
      unmappable_citywide_count: 6, limit: 5000,
    });

    const { container } = render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.click(screen.getByTestId("fire-viewport"));
    await waitFor(() => expect(getIncidentPoints).toHaveBeenCalled());

    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-half");
    expect(screen.queryByRole("button", { name: /42 reported incidents · 18 blocks/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-bar");
    expect(screen.getByRole("button", { name: /42 reported incidents · 18 blocks/i })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("fire-map-click"));
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-half");
    expect(screen.queryByRole("button", { name: /42 reported incidents · 18 blocks/i })).toBeNull();
  });

  it("runs analysis for a selected place", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    // The restored selection (all places = Home) auto-runs on load through the points path,
    // sending the saved place's id on the place_ids summary-refresh pass.
    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledWith({
        place_ids: ["p1"],
        analysis_start_date: window.analysis_start_date,
        analysis_end_date: window.analysis_end_date,
        radii_m: [250],
        offense_category: null,
        layer: "reported",
      });
    });
  });

  it("fetches incident details after analysis succeeds", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());

    render(<MapWorkspace />);
    await screen.findByText("Home");

    // The restored-selection auto-run sends inline points (not place_ids) to the
    // incident-details endpoint.
    await waitFor(() => {
      expect(getIncidentDetails).toHaveBeenCalledWith({
        points: [{ latitude: home.latitude, longitude: home.longitude, label: "Home" }],
        analysis_start_date: window.analysis_start_date,
        analysis_end_date: window.analysis_end_date,
        radii_m: [250],
        offense_category: null,
        layer: "reported",
      });
    });
    // Incident details render in the local card's expanded view on the rail.
    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    expect(await screen.findByRole("heading", { name: "Record disclosure" })).toBeInTheDocument();
  });

  it("fetches neighborhood analysis after analysis succeeds", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());

    render(<MapWorkspace />);
    await screen.findByText("Home");

    // The restored-selection auto-run sends inline points to the neighborhood endpoint.
    await waitFor(() => {
      expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ points: [expect.objectContaining({ label: "Home" })], radii_m: [250] }),
      );
    });
  });

  it("keeps filter changes out of the transcript under StrictMode", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });

    render(<StrictMode><MapWorkspace /></StrictMode>);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("button", { name: /search radius: 250 m/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));

    expect(screen.queryByText("Search radius → 500 m")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search radius: 500 m/i })).toHaveAttribute("aria-expanded", "false");
  });

  // The wordmark is a styled span, so the page had no h1 at all.
  it("exposes a screen-reader heading naming the app and what it reports", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    render(<MapWorkspace />);
    const heading = await screen.findByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("CompCat — reported Seattle incident context around addresses");
    expect(heading).toHaveClass("mc-sr");
  });

  it("shows an error when the session cannot start", async () => {
    vi.mocked(createSession).mockRejectedValue(new Error("no session"));
    render(<MapWorkspace />);
    // Rendered by both error surfaces in an empty app: the map banner and the rail alert.
    const alerts = await screen.findAllByText(/unable to start a dashboard session/i);
    expect(alerts.length).toBeGreaterThan(1);
  });

  // A failed first session left the app inert with no way forward but a manual reload.
  it("offers a retry when the first session fails, and recovers on success", async () => {
    vi.mocked(createSession)
      .mockRejectedValueOnce(new Error("no session"))
      .mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);
    await screen.findAllByText(/unable to start a dashboard session/i);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(screen.queryByText(/unable to start a dashboard session/i)).not.toBeInTheDocument();
  });

  it("offers a reload, not a retry, when the session bootstrap 401s", async () => {
    vi.mocked(createSession).mockRejectedValue(new Error(SESSION_EXPIRED_MESSAGE));
    render(<MapWorkspace />);
    await screen.findAllByText(new RegExp(SESSION_EXPIRED_MESSAGE.slice(0, 20), "i"));
    // Retrying the same dead session cannot help; only a reload mints a new one.
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  // The dot layer failed silently: an empty map reads as "nothing happened here".
  it("surfaces an incident-layer failure as a dismissible banner", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(getIncidentPoints).mockRejectedValue(new Error(SESSION_EXPIRED_MESSAGE));

    render(<MapWorkspace />);
    await screen.findByText("Home");
    fireEvent.click(screen.getByTestId("fire-viewport"));

    const message = await screen.findByText(new RegExp(SESSION_EXPIRED_MESSAGE.slice(0, 20), "i"));
    const banner = message.closest(".mc-banner-warn") as HTMLElement;
    expect(banner).toHaveAttribute("role", "alert");

    fireEvent.click(within(banner).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText(SESSION_EXPIRED_MESSAGE)).not.toBeInTheDocument());

    // Dismissing one failed request must not permanently hide the same honest warning when
    // a later viewport request fails with identical copy.
    fireEvent.click(screen.getByTestId("fire-viewport"));
    expect(await screen.findByText(new RegExp(SESSION_EXPIRED_MESSAGE.slice(0, 20), "i"))).toBeInTheDocument();
  });

  it("shows the session message when saving a searched address 401s", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(createPlace).mockRejectedValue(new Error(SESSION_EXPIRED_MESSAGE));
    geocodeSearch.mockResolvedValue([{ label: "500 Pine St", latitude: 47.63, longitude: -122.35, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "500 Pine" } });
    fireEvent.click(await screen.findByRole("option", { name: "500 Pine St" }));
    fireEvent.click(await screen.findByRole("button", { name: /save pin/i }));

    // Not the generic "Unable to save pin. Try again." — retrying cannot fix a dead session.
    expect(await screen.findByText(SESSION_EXPIRED_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText(/unable to save pin/i)).not.toBeInTheDocument();
  });

  it("stays on the rail when the assistant returns compare_places (no view switch)", async () => {
    const a: Place = { ...home, id: "a", display_label: "Alpha" };
    const b: Place = { ...work, id: "b", display_label: "Bravo" };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([a, b]));
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({
        event: "tool",
        data: {
          tool_name: "compare_places",
          result: {
            place_ids: ["a", "b"],
            settings_used: {
              radius_m: 250,
              analysis_start_date: "2026-01-01",
              analysis_end_date: "2026-06-30",
              offense_category: null,
            },
            comparison: makeSiteComparison("Alpha", "Bravo"),
          },
        },
      });
      handlers.onEvent({ event: "token", data: { delta: "Compared Alpha and Bravo." } });
      handlers.onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    await screen.findByText("Alpha");

    fireEvent.change(screen.getByLabelText("Analyst message"), {
      target: { value: "compare Alpha and Bravo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The turn completes and the bridge applies its effect without bouncing to a legacy
    // comparison view—the composer stays put while the result is carried by a thread card.
    await screen.findByText("Compared Alpha and Bravo.");
    expect(screen.getByLabelText("Analyst message")).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Compare" })).not.toBeInTheDocument();
  });

  it("stays on the rail when the assistant returns analyze_places (no view switch)", async () => {
    const a: Place = { ...home, id: "a", display_label: "Alpha" };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([a]));
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({
        event: "tool",
        data: {
          tool_name: "analyze_places",
          result: {
            place_ids: ["a"],
            settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
            neighborhood: makeNeighborhoodAnalysis(),
            incidents: makeIncidentDetails(),
          },
        },
      });
      handlers.onEvent({ event: "token", data: { delta: "Analyzed Alpha." } });
      handlers.onEvent({ event: "done", data: {} });
    });
    render(<MapWorkspace />);
    await screen.findByText("Alpha");
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    // The turn completes without bouncing to a legacy comparison view—the composer stays put.
    await screen.findByText("Analyzed Alpha.");
    expect(screen.getByLabelText("Analyst message")).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Compare" })).not.toBeInTheDocument();
    // analyze_places doesn't fire a cross-address comparison.
    expect(comparePlaces).not.toHaveBeenCalled();
  });

  it("hydrates a shared view from ?view= and runs the points path", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());

    const view = encodeView({
      points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
      radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31",
      layer: "reported", offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);
    expect(await screen.findByText(/shared view/i)).toBeInTheDocument();
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ points: expect.any(Array) })));
  });

  it("hydrates a shared Compare view and renders its comparison instead of the select-two prompt", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Pike Place", "Second Site"));

    const view = encodeView({
      points: [
        { latitude: 47.61, longitude: -122.34, label: "Pike Place" },
        { latitude: 47.62, longitude: -122.33, label: "Waterfront" },
      ],
      radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31",
      layer: "reported", offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);
    expect(await screen.findByText(/shared view/i)).toBeInTheDocument();
    await waitFor(() => expect(comparePlaces).toHaveBeenCalledWith(
      expect.objectContaining({ points: expect.any(Array) })));
    // The shared compare auto-run lands as a local card on the rail (not the legacy Compare
    // view): the card itself is the receipt, and — runId null — has no export link.
    expect(await screen.findByText("Reported Incident Context Report")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
    await waitFor(() => expect(fitToCaptures.length).toBeGreaterThan(0));
    const fit = fitToCaptures.at(-1) as {
      points: { lat: number; lng: number }[];
      padding: { top: number; right: number; bottom: number; left: number };
    };
    expect(fit.points).toEqual([
      { lat: 47.61, lng: -122.34 },
      { lat: 47.62, lng: -122.33 },
    ]);
    expect(fit.padding).toEqual({ top: 90, left: 40, right: 440, bottom: 40 });
  });

  it("leads a fresh session with Tabby's onboarding chips", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    render(<MapWorkspace />);
    expect(await screen.findByText(/point me at a place/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search an address" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Drop a pin" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add places manually" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /look up an address/i })).not.toBeInTheDocument();
  });

  it("focuses the search pill when the onboarding 'Search an address' chip is clicked", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    render(<MapWorkspace />);
    await screen.findByRole("button", { name: "Search an address" });

    fireEvent.click(screen.getByRole("button", { name: "Search an address" }));

    expect(screen.getByRole("combobox", { name: /search address or place/i })).toHaveFocus();
  });

  it("arms pin-drop mode when the onboarding 'Drop a pin' chip is clicked", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    const { container } = render(<MapWorkspace />);
    await screen.findByRole("button", { name: "Drop a pin" });

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin" }));

    expect(container.querySelector(".mc-frame")).toHaveClass("is-placing-pin");
  });

  it("looks up an address and runs its report via the points path without saving a place", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));

    // The lookup drops a draft pin on the map (via previewSearch) and flies to it.
    expect(await screen.findByTestId("draft-pin")).toBeInTheDocument();
    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    // The explicit report action runs the inline-points path; no place is saved, so the
    // place_ids summary-refresh pass is skipped entirely.
    await waitFor(() => {
      expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(expect.objectContaining({
        points: [{ latitude: 47.61, longitude: -122.34, label: "123 Main St" }],
        radii_m: [250],
        layer: "reported",
      }));
    });
    expect(analyzePlaces).not.toHaveBeenCalled();
    expect(createPlace).not.toHaveBeenCalled();
    // The report remains a compact reference while Tabby becomes the primary next step.
    expect(await screen.findByRole("button", { name: "View details" })).toBeInTheDocument();
    expect(screen.getByText("Report scope")).toBeInTheDocument();
    expect(screen.getByText("Ask Tabby about this report")).toBeInTheDocument();
    // A point-backed card can frame its frozen coordinates even though no dashboard Place
    // exists. The compact 400px pane leaves a 40px map gutter.
    const fit = fitToCaptures.at(-1) as {
      points: { lat: number; lng: number }[];
      padding: { top: number; right: number; bottom: number; left: number };
    };
    expect(fit.points).toEqual([{ lat: 47.61, lng: -122.34 }]);
    expect(fit.padding).toEqual({ top: 90, left: 40, right: 440, bottom: 40 });
  });

  it("lets a later search recenter supersede the last chip fly", async () => {
    flyToCaptures.length = 0;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));

    // The lookup itself flies the map to the looked-up address (pinDraft.flyTo).
    await waitFor(() => {
      expect(flyToCaptures[flyToCaptures.length - 1]).toEqual({ lat: 47.61, lng: -122.34 });
    });

    // Clicking the ad-hoc pin hands MapCanvas a FRESH chipFlyTo reference for its coords
    // (the real MapCanvas re-flies on reference change, even to the same spot).
    const adhocId = keyOf({ latitude: 47.61, longitude: -122.34 });
    const capturesBeforeChip = flyToCaptures.length;
    fireEvent.click(await screen.findByTestId(`marker-${adhocId}`));
    await waitFor(() => {
      expect(flyToCaptures.length).toBeGreaterThan(capturesBeforeChip);
      expect(flyToCaptures[flyToCaptures.length - 1]).toEqual({ lat: 47.61, lng: -122.34 });
    });

    // A later search recenter must supersede the chip fly — the stale chipFlyTo must not
    // swallow pinDraft.flyTo for the rest of the session.
    geocodeSearch.mockResolvedValue([{ label: "456 Oak St", latitude: 47.7, longitude: -122.2, source: "test" }]);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "456 Oak" } });
    fireEvent.click(await screen.findByRole("option", { name: "456 Oak St" }));
    await waitFor(() => {
      expect(flyToCaptures[flyToCaptures.length - 1]).toEqual({ lat: 47.7, lng: -122.2 });
    });
  });

  it("saves a looked-up address to places on request", async () => {
    const saved: Place = { ...home, id: "s1", display_label: "123 Main St", latitude: 47.61, longitude: -122.34 };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValueOnce(makeSummary()).mockResolvedValue(makeSummary([saved]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(createPlace).mockResolvedValue(saved);
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));

    // The lookup drops a draft pin whose Save popover persists the address to places.
    fireEvent.click(await screen.findByRole("button", { name: /save pin/i }));

    await waitFor(() => {
      expect(createPlace).toHaveBeenCalledWith({
        display_label: "123 Main St",
        latitude: 47.61,
        longitude: -122.34,
        visit_count: 1,
        sensitivity_class: "normal",
      });
    });
    // The save links the lookup's ad-hoc entry to the created place in place (markSaved,
    // not dedup-add): ONE chip, checked — no unchecked duplicate.
    await waitFor(() => {
      const chips = screen.getAllByRole("checkbox", { name: "123 Main St" });
      expect(chips).toHaveLength(1);
      expect(chips[0]).toHaveAttribute("aria-checked", "true");
    });
    // The linked entry is saved now, so no ad-hoc synthetic pin remains on the map.
    const last = canvasCaptures[canvasCaptures.length - 1]!;
    expect((last.places as { inferred_place_type: string }[]).some((p) => p.inferred_place_type === "adhoc_entry")).toBe(false);
  });

  it("clears an active lookup when the assistant drives a new pane", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({
        event: "tool",
        data: {
          tool_name: "analyze_places",
          result: {
            place_ids: ["a"],
            settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
            neighborhood: makeNeighborhoodAnalysis(),
            incidents: makeIncidentDetails(),
          },
        },
      });
      handlers.onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));
    expect(await screen.findByTestId("draft-pin")).toBeInTheDocument();

    // The assistant now takes over the pane with a different selection; the ephemeral lookup
    // (and its draft pin) must be dropped so it no longer shadows the assistant's subject.
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.queryByTestId("draft-pin")).not.toBeInTheDocument());
  });

  it("auto-runs analysis on load with the restored selection and lands a rail card", async () => {
    localStorage.setItem("compcat.selection", JSON.stringify([home.id]));
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());

    render(<MapWorkspace />);

    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledTimes(1);
      expect(analyzePlaces).toHaveBeenCalledWith(
        expect.objectContaining({ place_ids: [home.id] }),
      );
    });
    // The restored auto-run lands as a runId-null analyze card on the rail — no view switch,
    // and no run-scoped export link.
    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());
    expect(screen.queryByText(/details in the card/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("replaces a stale restored report when the user updates its scope", async () => {
    localStorage.setItem("compcat.selection", JSON.stringify([home.id]));
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockImplementation(async () => makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockImplementation(async () => makeIncidentDetails());

    render(<MapWorkspace />);

    // A returning session gets one collapsed quick report automatically.
    await waitFor(() => expect(analyzePlaces).toHaveBeenCalledTimes(1));
    await screen.findByRole("button", { name: "View details" });
    expect(document.querySelectorAll(".mc-result-card")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Search radius: 250 m" }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    fireEvent.click(screen.getByRole("button", { name: "Update report" }));

    // The updated report replaces that stale quick report in place. It must not leave the
    // automatic card behind as a second, historical "Previous analysis" card.
    await waitFor(() => expect(analyzePlaces).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("button", { name: "View details" })).toBeInTheDocument();
    expect(await screen.findByText("Ask Tabby about this report")).toBeInTheDocument();
    expect(document.querySelectorAll(".mc-result-card")).toHaveLength(1);
    expect(screen.queryByText("Previous analysis")).not.toBeInTheDocument();
  });

  it("auto-runs with all places when nothing is stored", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });

    render(<MapWorkspace />);

    await waitFor(() =>
      expect(analyzePlaces).toHaveBeenCalledWith(
        expect.objectContaining({ place_ids: expect.arrayContaining([home.id, work.id]) }),
      ),
    );
  });

  it("does not auto-run for an empty session", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    render(<MapWorkspace />);

    await screen.findByText(/point me at a place/i);
    expect(analyzePlaces).not.toHaveBeenCalled();
  });

  it("exits a shared view and appends the clicked chip place without auto-running", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());

    const view = encodeView({
      points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
      radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31",
      layer: "reported", offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);

    // The shared view auto-runs its single point once.
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1));
    await screen.findByText(/shared view/i);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    const chip = await screen.findByRole("checkbox", { name: home.display_label });
    fireEvent.click(chip);

    // The chip click exits the shared banner and APPENDS the saved place to the list
    // alongside the shared row — a manual edit, so it does NOT auto-run.
    expect(screen.queryByText(/shared view/i)).not.toBeInTheDocument();
    // The appended saved place shows as a checked chip on the rail (the shared "Pike Place"
    // is an ad-hoc entry — a map pin, not a saved chip). No auto-run fires on the edit.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: home.display_label })).toHaveAttribute("aria-checked", "true"));
    expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1);
  });

  it("narrow viewport: the layer toggle mounts in the sheet, not the top bar", async () => {
    window.innerWidth = 375;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(getDashboardFreshness).mockResolvedValue({
      reported: { incident_count: 386, earliest: "2018-01-01", data_through: "2025-10-27", last_ingested_at: "2026-07-20" },
      arrests: { incident_count: 0, earliest: null, data_through: null, last_ingested_at: null },
      calls: { incident_count: 0, earliest: null, data_through: null, last_ingested_at: null },
    });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    const group = screen.getByRole("group", { name: "Data layer" });
    expect(group.closest(".mc-workspace-panel")).not.toBeNull();
    expect(group.closest(".mc-topbar")).toBeNull();
    const freshness = await screen.findByText("Data through Oct 27, 2025");
    expect(freshness.closest(".mc-sheet-head")).toBeNull();
    expect(freshness.closest(".mc-ctx-metadata")).not.toBeNull();
  });

  it("wide viewport: the layer toggle mounts in the top bar", async () => {
    window.innerWidth = 1440;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);
    await screen.findByText("Home");

    const group = screen.getByRole("group", { name: "Data layer" });
    expect(group.closest(".mc-topbar")).not.toBeNull();
    expect(group.closest(".mc-workspace-panel")).toBeNull();
  });

  it("at exactly 1280px uses the compact desktop header without switching to a sheet", async () => {
    window.innerWidth = 1280;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    const { container } = render(<MapWorkspace />);
    await screen.findByText("Home");

    expect(container.querySelector(".mc-frame")).toHaveClass("is-compact-desktop");
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-open");
    expect(container.querySelector(".mc-grabber")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-topbar .mc-layertoggle")).not.toBeInTheDocument();
    expect(container.querySelector(".mc-topbar .mc-status")).not.toBeInTheDocument();
    // The non-duplicated filter remains reachable in the panel.
    expect(screen.getByRole("button", { name: "Data layer: Reported incidents" }).closest(".mc-workspace-panel")).not.toBeNull();
  });

  it("legacy 1-point analyze share link auto-runs and lands as a local card on the rail", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([]));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "analyze", r: 250, s: "2026-01-01", e: "2026-06-24", ly: "reported",
      pts: [{ y: 47.61, x: -122.33, l: "Shared spot" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    window.history.replaceState(null, "", `/?view=${legacy}`);
    render(<MapWorkspace />);
    // The auto-run lands as a runId-null analyze card on the rail — no legacy Compare view.
    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());
    expect(screen.queryByText(/details in the card/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      points: [expect.objectContaining({ label: "Shared spot" })],
    })));
    expect(comparePlaces).not.toHaveBeenCalled();
  });

  it("applies an assistant analyze_places effect without leaving the rail", async () => {
    const a: Place = { ...home, id: "a", display_label: "Alpha" };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([a]));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    const neighborhood: NeighborhoodAnalysis = {
      ...makeNeighborhoodAnalysis(),
      places: [{
        place_id: "n-a", place_label: "Alpha", beat: "M2", radius_m: 250,
        baseline_available: false, decision: "baseline_unavailable", place_incident_count: 3,
        place_rate: 0.5, place_rate_ci_lower: 0.3, place_rate_ci_upper: 0.8,
        minimum_data_status: "met", nearest_incident_m: 40, monthly_counts: [],
        category_breakdown: [], baselines: [],
      }],
    };
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({
        event: "tool",
        data: {
          tool_name: "analyze_places",
          result: {
            place_ids: ["a"],
            settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
            neighborhood,
            incidents: makeIncidentDetails(),
          },
        },
      });
      handlers.onEvent({ event: "done", data: {} });
    });
    render(<MapWorkspace />);
    await screen.findByRole("checkbox", { name: "Alpha" });
    // The restored-selection auto-run fires its own summary refresh (call #2) — let it
    // settle first so the wait below is unambiguously the tool effect's own refetch.
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    // The tool effect's refetchSummary is the only observable completion signal here (this
    // mock emits no token event) — it fires once the bridge applies the effect.
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(3));
    // No view switch: the composer stays on the rail while the result is carried by a card.
    expect(screen.getByLabelText("Analyst message")).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Compare" })).not.toBeInTheDocument();
    expect(comparePlaces).not.toHaveBeenCalled();
  });

  it("deleting a saved place drops it from the selected chips", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(deletePlace).mockResolvedValue(undefined);

    render(<MapWorkspace />);
    await screen.findByText("Home");
    // The restored selection seeds both places into the address list → both chips checked.
    expect(await screen.findByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Work" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Manage places" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage places" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Remove Home" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove place" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    // handleDelete drops the deleted place's entry from the one address list, so its chip
    // deselects while the surviving place's chip stays checked.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.getByRole("checkbox", { name: "Work" })).toHaveAttribute("aria-checked", "true");
  });

  it("clears every pin from the search shortcut after confirmation", async () => {
    let serverPlaces = [home, work];
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockImplementation(async () => makeSummary(serverPlaces));
    vi.mocked(deleteAllPlaces).mockImplementation(async () => {
      serverPlaces = [];
    });
    sessionStorage.setItem("compcat.search.recent", JSON.stringify([
      { label: "Pike Place Market", latitude: 47.6097, longitude: -122.3331, source: "nominatim" },
    ]));

    render(<MapWorkspace />);
    await screen.findByText("Home");
    const shortcut = screen.getByRole("button", { name: "Clear all pins" });
    expect(shortcut).toBeEnabled();
    fireEvent.click(shortcut);

    const dialog = screen.getByRole("dialog", { name: "Clear all pins?" });
    expect(dialog).toHaveTextContent("This removes 2 saved places from this session.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear all pins" }));

    await waitFor(() => {
      expect(deleteAllPlaces).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("dialog", { name: "Clear all pins?" })).not.toBeInTheDocument();
    });
    expect(sessionStorage.getItem("compcat.search.recent")).toBeNull();
    await waitFor(() => {
      const last = canvasCaptures[canvasCaptures.length - 1]!;
      expect(last.places).toEqual([]);
      expect(shortcut).toBeDisabled();
    });
  });

  it("synthesizes lettered pins for ad-hoc entries", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    geocodeSearch.mockResolvedValue([{ label: "500 Pine St", latitude: 47.63, longitude: -122.35, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText("Home");

    // A search-pill lookup adds the ad-hoc address (no saved place); it becomes a synthetic
    // map pin keyed by its coordinate key.
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "500 Pine" } });
    fireEvent.click(await screen.findByRole("option", { name: "500 Pine St" }));

    // The last canvas capture carries a synthetic ad-hoc place keyed by its coordinate key,
    // and that id is present in selectedIds so it renders as a lettered "selected" pin.
    await waitFor(() => {
      const last = canvasCaptures[canvasCaptures.length - 1]!;
      const synthetic = (last.places as { id: string; inferred_place_type: string }[]).find((p) => p.inferred_place_type === "adhoc_entry");
      expect(synthetic).toBeDefined();
      expect(last.selectedIds.has(synthetic!.id)).toBe(true);
    });
    expect(screen.getByRole("button", { name: "Show 500 Pine St on map — Unsaved" })).toHaveTextContent("Unsaved");
    expect(screen.getByRole("button", { name: "Remove 500 Pine St from analysis" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save pin/i })).toBeInTheDocument();
  });

  it("saves a searched address from its chip with a payload the backend accepts", async () => {
    const saved: Place = { ...home, id: "s2", display_label: "500 Pine St", latitude: 47.63, longitude: -122.35 };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValueOnce(makeSummary()).mockResolvedValue(makeSummary([saved]));
    vi.mocked(createPlace).mockResolvedValue(saved);
    geocodeSearch.mockResolvedValue([{ label: "500 Pine St", latitude: 47.63, longitude: -122.35, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "500 Pine" } });
    fireEvent.click(await screen.findByRole("option", { name: "500 Pine St" }));

    // Dismiss the draft-pin popover so the chip's own Save (handleSaveEntry) is the control
    // under test — the popover's saveDraft path is a different call site.
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(await screen.findByRole("button", { name: "Save 500 Pine St" }));

    await waitFor(() => expect(createPlace).toHaveBeenCalled());
    // createPlace is mocked suite-wide, so a payload the API would 422 on still "passes"
    // unless it is checked against the documented contract.
    const payload = vi.mocked(createPlace).mock.calls[0]![0];
    assertValidPlaceCreate(payload);
    expect(payload).toMatchObject({
      display_label: "500 Pine St",
      latitude: 47.63,
      longitude: -122.35,
      sensitivity_class: "normal",
    });

    // The ad-hoc chip is replaced in place by a saved, checked place chip.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "500 Pine St" })).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.queryByRole("button", { name: "Show 500 Pine St on map — Unsaved" })).not.toBeInTheDocument();
  });

  it("replaces a stale card with a compact previous-report reference while filters change", async () => {
    localStorage.setItem("compcat.selection", JSON.stringify([home.id]));
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());

    render(<MapWorkspace />);
    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());
    expect(screen.getByText("Analysis report")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: /search radius: 250 m/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));

    const previousBar = screen.getByText("Previous report").closest(".mc-stale-report-bar");
    expect(previousBar).toHaveTextContent("Kept for reference");
    expect(document.querySelector(".mc-result-card")).not.toBeInTheDocument();

    fireEvent.click(within(previousBar as HTMLElement).getByRole("button", { name: "View" }));
    expect(document.querySelector(".mc-result-card")).toHaveClass("is-historical");
    expect(screen.getByRole("button", { name: "Collapse" })).toBeInTheDocument();
  });

  it("clicking an ad-hoc pin flies to it instead of removing the entry", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    geocodeSearch.mockResolvedValue([{ label: "500 Pine St", latitude: 47.63, longitude: -122.35, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "500 Pine" } });
    fireEvent.click(await screen.findByRole("option", { name: "500 Pine St" }));

    // The synthetic's marker uses the entry's coordinate key as its id.
    const adhocId = keyOf({ latitude: 47.63, longitude: -122.35 });
    fireEvent.click(await screen.findByTestId(`marker-${adhocId}`));

    // Focus, not destroy: the ad-hoc entry stays a map pin and the map flies to its coords.
    const last = canvasCaptures[canvasCaptures.length - 1]!;
    expect((last.places as { id: string }[]).some((p) => p.id === adhocId)).toBe(true);
    expect(flyToCaptures[flyToCaptures.length - 1]).toEqual({ lat: 47.63, lng: -122.35 });
  });

  it("exits a shared banner back to the restored saved-place list", async () => {
    localStorage.setItem("compcat.selection", JSON.stringify([home.id]));
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Shared A", "Shared B"));

    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "compare", r: 250, s: "2026-01-01", e: "2026-06-24", ly: "reported",
      pts: [{ y: 47.7, x: -122.4, l: "Shared A" }, { y: 47.71, x: -122.41, l: "Shared B" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    window.history.replaceState(null, "", `/?view=${legacy}`);
    render(<MapWorkspace />);

    // Shared view auto-runs its two points once; wait until places have loaded so the
    // persisted selection has been restored (the guard the Exit path depends on).
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalled());

    fireEvent.click(await screen.findByRole("button", { name: "Exit" }));

    // Exit restores the persisted saved selection ([home]) and re-runs it: home shows as a
    // checked chip and the neighborhood endpoint is hit a second time.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: home.display_label })).toHaveAttribute("aria-checked", "true"));
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(2));
  });

  it("banner Exit before the data load keeps the shared list instead of clearing it", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    // getDashboardSummary never resolves during this test: data.places stays empty and
    // the persisted selection is never restored — the state Exit must guard against.
    vi.mocked(getDashboardSummary).mockReturnValue(new Promise<DashboardSummary>(() => {}));
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Downtown test point", "North test point"));

    const view = encodeView({
      points: [
        { latitude: 47.6005, longitude: -122.3315, label: "Downtown test point" },
        { latitude: 47.6595, longitude: -122.3125, label: "North test point" },
      ],
      radiusM: 250, startDate: "2026-01-01", endDate: "2026-06-24",
      layer: "reported", offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);

    // Click Exit as soon as the banner renders — before any load has landed.
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));

    // The kept shared rows remain as ad-hoc map pins (no saved place → pins, not chips).
    expect(screen.queryByText(/shared view/i)).not.toBeInTheDocument();
    const last = canvasCaptures[canvasCaptures.length - 1]!;
    const adhoc = (last.places as { inferred_place_type: string }[]).filter((p) => p.inferred_place_type === "adhoc_entry");
    expect(adhoc).toHaveLength(2);
  });

  it("does not double-run a requested lookup report when places finish loading", async () => {
    let resolveSummary!: (value: DashboardSummary) => void;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockReturnValue(new Promise<DashboardSummary>((resolve) => { resolveSummary = resolve; }));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    // Fire a search-pill lookup before the dashboard summary resolves.
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));

    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1));

    // Places arrive after the lookup edit; the restore greet must not fire a second run.
    resolveSummary(makeSummary([home]));
    await screen.findByTestId("marker-p1");
    expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1);
  });

  it("keeps assistant selected_place_ids fresh after restore-seeding", async () => {
    localStorage.setItem("compcat.selection", JSON.stringify([home.id]));
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(streamAssistantChat).mockResolvedValue(undefined);

    render(<MapWorkspace />);
    // Wait for the restore-seeded greet run (home is saved → place_ids pass).
    await waitFor(() => expect(analyzePlaces).toHaveBeenCalledWith(expect.objectContaining({ place_ids: [home.id] })));

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(streamAssistantChat).toHaveBeenCalled());
    const payload = vi.mocked(streamAssistantChat).mock.calls[0][0];
    expect(payload.dashboard_state.selected_place_ids).toEqual([home.id]);
  });

  it("clears the panes and the address list when the assistant clears the selection", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Home", "Work"));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({ event: "tool", data: { tool_name: "select_places", result: { place_ids: [], mode: "clear" } } });
      handlers.onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    // The restored two-place selection auto-runs and lands a compare card on the rail.
    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "clear" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The clear result empties the address list (invalidate), so both saved-place chips deselect.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.getByRole("checkbox", { name: "Work" })).toHaveAttribute("aria-checked", "false");
  });

  it("drops stale panes when the assistant replaces the selection without new results", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Home", "Work"));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({ event: "tool", data: { tool_name: "select_places", result: { place_ids: ["p2"], mode: "replace" } } });
      handlers.onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    // The restored two-place selection auto-runs and lands a compare card on the rail.
    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "just Work" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // A payload-free selection replace is an edit: the address list swaps to the replacement
    // row, so Work stays selected while Home deselects.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Work" })).toHaveAttribute("aria-checked", "true");
    });
    expect(screen.getByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "false");
  });

  it("resolves a queued place id from a held pin-save refresh into the selection", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Home", "Work"));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });
    vi.mocked(createPlace).mockResolvedValue(pin9);

    render(<MapWorkspace />);
    // The restored two-place selection auto-runs and lands a compare card on the rail.
    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());

    // Pin-save "Pin 9": createPlace resolves, but HOLD the save's summary refresh open so
    // p9 stays queued as pending (it isn't in data.places until that refresh lands).
    let resolveSummary!: (value: DashboardSummary) => void;
    vi.mocked(getDashboardSummary).mockReturnValueOnce(new Promise<DashboardSummary>((resolve) => { resolveSummary = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Pin 9" } });
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));
    // The offer-bearing save lands on the rail once createPlace resolves.
    await screen.findByText("Saved Pin 9. Want me to pull what's on file nearby?");

    // The held refresh now lands WITH p9's place: the queued id resolves and joins the
    // address list, so Pin 9 shows as a checked chip on the rail.
    resolveSummary(makeSummary([home, work, pin9]));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Pin 9" })).toHaveAttribute("aria-checked", "true"));
  });

  it("resolves a queued place id from an assistant compare_places refetch without leaving the rail", async () => {
    // compare-by-name: the backend creates the unsaved place and returns its id, so the
    // bridge's replace queues an id that data.places can't resolve yet. The tool effect's
    // own summary refetch delivers it. Comparison-card persistence is covered separately;
    // this regression stays focused on resolving the queued identity without leaving the rail.
    const pike: Place = { ...home, id: "p9", display_label: "Pike Street", latitude: 47.63, longitude: -122.35 };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({
        event: "tool",
        data: {
          tool_name: "compare_places",
          result: {
            place_ids: ["p1", "p2", "p9"],
            settings_used: {
              radius_m: 250,
              analysis_start_date: "2026-01-01",
              analysis_end_date: "2026-06-30",
              offense_category: null,
            },
            comparison: makeSiteComparison("Home", "Work"),
          },
        },
      });
      handlers.onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    // Wait for the restored selection to SEED the list (checked chip) — not just render.
    fireEvent.click(await screen.findByRole("button", { name: "Change" }));
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "true"));
    // Let the greet run's own summary refresh land first, so the deferred below is
    // consumed by the tool effect's refetch and nothing else.
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2));
    let resolveSummary!: (value: DashboardSummary) => void;
    vi.mocked(getDashboardSummary).mockReturnValueOnce(new Promise<DashboardSummary>((resolve) => { resolveSummary = resolve; }));

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "compare with Pike Street" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The tool effect fires its own refetch (call #3) while p9 is still pending resolution;
    // the flow stays on the rail throughout (no view switch).
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText("Analyst message")).toBeInTheDocument();

    // The refetch lands WITH p9's place: the queued id resolves and joins the address list,
    // so Pike Street shows as a checked chip on the rail.
    resolveSummary(makeSummary([home, work, pike]));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Pike Street" })).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("runs the compare chip as a structured command and applies its effect on the rail", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    // Keep the restored-selection auto-run pending. If its card lands first it replaces
    // the empty-state command chips with card follow-ups, making this test order-dependent.
    vi.mocked(getNeighborhoodAnalysis).mockReturnValue(new Promise(() => {}));
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    // The command stream returns an update_filters tool event regardless of the sent
    // command — pinning both the outgoing payload and the effect→receipt round-trip.
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "tool", data: { tool_name: "update_filters", arguments: {}, result: { patch: { radius_m: 500 } } } });
      onEvent({ event: "token", data: { delta: "Updated the filters: radius 500 m." } });
      onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    // Wait for the restored selection to SEED the list (checked chip), not just for the
    // chip strip to render — savedIdSet derives from the seeded entries, and a click that
    // beats the seed effect would send place_ids: [].
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "true"));

    fireEvent.click(screen.getByRole("button", { name: "Compare my places" }));

    // The chip runs the structured command path (never /assistant/chat) with the saved
    // ids AND the dashboard window — without dates + radius the tool clarifies, not runs.
    await waitFor(() => expect(streamAssistantCommand).toHaveBeenCalled());
    expect(streamAssistantChat).not.toHaveBeenCalled();
    const window = currentYearAnalysisWindow();
    const payload = vi.mocked(streamAssistantCommand).mock.calls[0][0];
    expect(payload.command).toBe("compare_places");
    expect(payload.arguments).toEqual(expect.objectContaining({
      place_ids: ["p1"],
      radius_m: 250,
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
    }));

    // The update_filters effect updates and highlights the shared control, replacing the
    // generated summary with one deterministic, undoable receipt.
    await waitFor(() => expect(screen.getByRole("button", { name: /search radius: 500 m/i })).toBeInTheDocument());
    expect(screen.getByText("Tabby changed the radius from 250 m to 500 m.")).toBeInTheDocument();
    expect(screen.queryByText("Updated the filters: radius 500 m.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /search radius: 500 m/i }).closest(".mc-ctx-filter"))
      .toHaveClass("is-assistant-updated");

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(screen.getByRole("button", { name: /search radius: 250 m/i })).toBeInTheDocument();
    expect(screen.getByText("Previous filters restored.")).toBeInTheDocument();
    expect(screen.getByLabelText("Analyst message")).toBeInTheDocument();
  });

  it("keeps filters live while the composer degrades on an LLM outage", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(streamAssistantChat).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "error", data: { message: "Couldn't reach the analyst.", code: "llm_unreachable" } });
    });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    // Command chips are live before any turn (offline is false).
    expect(screen.getByRole("button", { name: "Compare my places" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "what's the safest block" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The llm_unreachable code flows client → hook → panel: the composer degrades to a
    // disabled textarea + Send behind the offline hint.
    expect(await screen.findByText("Couldn't reach the analyst.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Analyst message")).toBeDisabled());
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/chips and filters still work/i)).toBeInTheDocument();

    // Filters are not gated by offline, and the change stays in the direct filter controls.
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: /search radius: 250 m/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(screen.getByRole("button", { name: /search radius: 500 m/i })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Search radius → 500 m")).not.toBeInTheDocument();
  });

  // --- Thread cards, follow-up chips, width toggle, and run-scoped export ---

  // The frozen result the assistant analyze flow emits, with a window that DIFFERS from the
  // live current-year default so the frozen-vs-live distinction is observable.
  function analyzeCardResult(extra: Record<string, unknown> = {}) {
    return {
      place_ids: ["a"],
      settings_used: {
        radius_m: 250,
        analysis_start_date: "2026-01-01",
        analysis_end_date: "2026-06-30",
        offense_category: null,
        layer: "reported",
      },
      neighborhood: makeNeighborhoodAnalysis(),
      incidents: makeIncidentDetails(),
      ...extra,
    };
  }

  function mockAnalyzeChat(result: Record<string, unknown>) {
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({ event: "tool", data: { tool_name: "analyze_places", result } });
      handlers.onEvent({ event: "token", data: { delta: "Analyzed Alpha." } });
      handlers.onEvent({ event: "done", data: {} });
    });
  }

  // Shared setup for the card tests: a single saved place, the auto-run's compare mocks, and
  // the analyze chat mock. Returns after the composer is reachable again on the rail.
  async function renderWithAnalyzeCard(result: Record<string, unknown>) {
    const a: Place = { ...home, id: "a", display_label: "Alpha" };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([a]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    mockAnalyzeChat(result);
    const view = render(<MapWorkspace />);
    await screen.findByText("Alpha");
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Analyzed Alpha.");
    return view;
  }

  it("appends a concise analysis result to the rail without repeating the active filters", async () => {
    const neighborhood: NeighborhoodAnalysis = {
      ...makeNeighborhoodAnalysis(),
      places: [{
        place_id: "n-a", place_label: "Alpha", beat: "M2", radius_m: 250,
        baseline_available: false, decision: "baseline_unavailable", place_incident_count: 3,
        place_rate: 0.5, place_rate_ci_lower: 0.3, place_rate_ci_upper: 0.8,
        minimum_data_status: "met", nearest_incident_m: 40, monthly_counts: [],
        category_breakdown: [], baselines: [],
      }],
    };
    const { container } = await renderWithAnalyzeCard(analyzeCardResult({ neighborhood }));

    const newestCard = Array.from(container.querySelectorAll(".mc-result-card")).at(-1);
    expect(newestCard?.textContent).toMatch(/Alpha/);
    expect(newestCard?.textContent).not.toMatch(/250 m/);
    expect(newestCard?.textContent).not.toMatch(/no beat baseline/);
    // No view switch — the card lives in the thread and the composer stays on the rail.
    expect(screen.getByLabelText("Analyst message")).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Compare" })).not.toBeInTheDocument();
  });

  it("re-runs a follow-up chip against the card's FROZEN scope, not the live dashboard", async () => {
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "done", data: {} });
    });
    await renderWithAnalyzeCard(analyzeCardResult());

    fireEvent.click(await screen.findByRole("button", { name: "Widen to 500 m" }));
    await waitFor(() => expect(streamAssistantCommand).toHaveBeenCalled());
    const payload = vi.mocked(streamAssistantCommand).mock.calls[0][0];
    expect(payload.command).toBe("analyze_places");
    // radii_m carries the chip's widen patch; the window is the CARD's (2026-06-30), never the
    // live current-year default (2026-07-19) — proving the re-run reads frozen settings.
    expect(payload.arguments).toEqual(expect.objectContaining({
      place_ids: ["a"],
      radii_m: [500],
      analysis_start_date: "2026-01-01",
      analysis_end_date: "2026-06-30",
      layer: "reported",
    }));
    expect(payload.arguments).not.toHaveProperty("radius_m");
    // The card window (2026-06-30) is not the live current-year default, so the objectContaining
    // above can only pass by reading the frozen card settings.
    expect(currentYearAnalysisWindow().analysis_end_date).not.toBe("2026-06-30");
  });

  it("expanding a card widens the drawer and collapsing restores the prior width", async () => {
    const { container } = await renderWithAnalyzeCard(analyzeCardResult());
    const widthNow = () => (container.querySelector(".mc-workspace-panel") as HTMLElement).style.width;

    expect(widthNow()).toBe("400px");
    // Two cards now sit on the rail (the restored auto-run's + the assistant's); expand the
    // newest. Only one card expands at a time, so Collapse is then unambiguous.
    fireEvent.click(screen.getAllByRole("button", { name: "View details" }).at(-1)!);
    expect(widthNow()).toBe("720px");
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(widthNow()).toBe("400px");
  });

  it("expanding a card does not shrink a drawer already wider than the detail minimum", async () => {
    localStorage.setItem("compcat.drawer.width", "800");
    const { container } = await renderWithAnalyzeCard(analyzeCardResult());
    const widthNow = () => (container.querySelector(".mc-workspace-panel") as HTMLElement).style.width;

    expect(widthNow()).toBe("800px");
    fireEvent.click(screen.getAllByRole("button", { name: "View details" }).at(-1)!);
    expect(widthNow()).toBe("800px");
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(widthNow()).toBe("800px");
  });

  it("narrow viewport: expanding a card raises the sheet to full, collapsing restores half", async () => {
    window.innerWidth = 400;
    const { container } = await renderWithAnalyzeCard(analyzeCardResult());
    const panel = () => container.querySelector(".mc-workspace-panel") as HTMLElement;

    expect(panel()).toHaveClass("is-half");
    // Two cards on the rail (restored auto-run + assistant); expand the newest.
    fireEvent.click(screen.getAllByRole("button", { name: "View details" }).at(-1)!);
    expect(panel()).toHaveClass("is-full");
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(panel()).toHaveClass("is-half");
  });

  it("the card export link carries the run-scoped run_id", async () => {
    await renderWithAnalyzeCard(analyzeCardResult({ analysis_run_id: "run-xyz" }));
    const link = screen.getByRole("link", { name: "Legacy reference-circle CSV" });
    expect(link).toHaveAttribute("href", "/exports/analysis.csv?run_id=run-xyz");
  });

  // --- Presence badges, focused cards, and fit-on-analysis ---

  const badge = (place_id: string, label: string) => ({
    place_id, label, run_id: "run-1", settings_fingerprint: "fp0123456789",
  });

  it("shows presence badges for analyzed places and fits the camera with drawer-aware padding", async () => {
    await renderWithAnalyzeCard(analyzeCardResult({ badges: [badge("a", "Alpha")] }));

    // The analyzed place gets a presence badge on its pin.
    expect(await screen.findByTestId("badge-a")).toBeInTheDocument();

    // Fit-on-analysis captured the analyzed place's point with drawer-width-aware padding.
    const fit = fitToCaptures.at(-1) as {
      points: { lat: number; lng: number }[];
      padding: { top: number; right: number; bottom: number; left: number };
    };
    expect(fit.points).toEqual([{ lat: home.latitude, lng: home.longitude }]);
    // Desktop (jsdom 1024px): default drawer width 400 + 40 gutter on the right.
    expect(fit.padding).toEqual({ top: 90, left: 40, right: 440, bottom: 40 });
  });

  it("narrow viewport: fitTo bottom inset tracks the sheet's snap (bar vs half)", async () => {
    window.innerWidth = 400;

    // Default state: not collapsed, snap "half".
    const half = await renderWithAnalyzeCard(analyzeCardResult({ badges: [badge("a", "Alpha")] }));
    await screen.findByTestId("badge-a");
    const halfFit = fitToCaptures.at(-1) as { padding: { bottom: number } };
    expect(halfFit.padding.bottom).toBe(snapHeightPx("half", window.innerHeight));
    half.unmount();

    try {
      localStorage.setItem("compcat.drawer.collapsed", "true");
      localStorage.setItem("compcat.drawer.snap", "bar");
      fitToCaptures.length = 0;
      await renderWithAnalyzeCard(analyzeCardResult({ badges: [badge("a", "Alpha")] }));
      await screen.findByTestId("badge-a");
      const barFit = fitToCaptures.at(-1) as { padding: { bottom: number } };
      expect(barFit.padding.bottom).toBe(snapHeightPx("bar", window.innerHeight));
    } finally {
      localStorage.removeItem("compcat.drawer.collapsed");
      localStorage.removeItem("compcat.drawer.snap");
    }
  });

  it("tapping a presence badge scrolls its newest matching card into view", async () => {
    await renderWithAnalyzeCard(analyzeCardResult({ badges: [badge("a", "Alpha")] }));
    expect(await screen.findByTestId("badge-a")).toBeInTheDocument();

    const scrollSpy = vi.fn();
    Element.prototype.scrollIntoView = scrollSpy;
    fireEvent.click(screen.getByTestId("badge-a"));

    // The panel scrolls the matching card into view; the composer stays on the rail.
    expect(screen.getByLabelText("Analyst message")).toBeInTheDocument();
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "start" }));
  });

  it("narrow viewport: tapping a presence badge on a bar sheet raises it to half", async () => {
    window.innerWidth = 400;
    localStorage.setItem("compcat.drawer.collapsed", "true");
    localStorage.setItem("compcat.drawer.snap", "bar");
    try {
      const { container } = await renderWithAnalyzeCard(analyzeCardResult({ badges: [badge("a", "Alpha")] }));
      expect(await screen.findByTestId("badge-a")).toBeInTheDocument();
      expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-bar");

      fireEvent.click(screen.getByTestId("badge-a"));

      expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-half");
    } finally {
      localStorage.removeItem("compcat.drawer.collapsed");
      localStorage.removeItem("compcat.drawer.snap");
    }
  });

  it("clears presence badges when the analysis context changes via the strip", async () => {
    await renderWithAnalyzeCard(analyzeCardResult({ badges: [badge("a", "Alpha")] }));
    expect(await screen.findByTestId("badge-a")).toBeInTheDocument();

    // A radius change through the rail's context strip invalidates the analysis context,
    // detaching the presence badges.
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: /search radius: 250 m/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));

    await waitFor(() => expect(screen.queryByTestId("badge-a")).not.toBeInTheDocument());
  });

  it("deleting a place clears ALL live presence badges", async () => {
    // Spec-aligned (review ruling): delete invalidates the WHOLE analysis context, so every
    // badge drops — not just the deleted place's.
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Home", "Work"));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(deletePlace).mockResolvedValue(undefined);
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({
        event: "tool",
        data: {
          tool_name: "compare_places",
          result: {
            place_ids: ["p1", "p2"],
            settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
            comparison: makeSiteComparison("Home", "Work"),
            badges: [badge("p1", "Home"), badge("p2", "Work")],
          },
        },
      });
      handlers.onEvent({ event: "token", data: { delta: "Compared Home and Work." } });
      handlers.onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    await screen.findByText("Home");
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "compare" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Both analyzed places carry a presence badge.
    expect(await screen.findByTestId("badge-p1")).toBeInTheDocument();
    expect(screen.getByTestId("badge-p2")).toBeInTheDocument();

    // Deleting ONE place clears EVERY badge (delete invalidates the whole context).
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Manage places" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage places" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Remove Home" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove place" }));

    await waitFor(() => {
      expect(screen.queryByTestId("badge-p1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("badge-p2")).not.toBeInTheDocument();
    });
  });

  it("detaches badges when an assistant update_filters effect changes the settings", async () => {
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Home", "Work"));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(streamAssistantChat)
      .mockImplementationOnce(async (_payload, handlers) => {
        handlers.onEvent({
          event: "tool",
          data: {
            tool_name: "compare_places",
            result: {
              place_ids: ["p1", "p2"],
              settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
              comparison: makeSiteComparison("Home", "Work"),
              badges: [badge("p1", "Home"), badge("p2", "Work")],
            },
          },
        });
        handlers.onEvent({ event: "done", data: {} });
      })
      .mockImplementationOnce(async (_payload, handlers) => {
        handlers.onEvent({
          event: "tool",
          data: { tool_name: "update_filters", result: { patch: { radius_m: 1000 } } },
        });
        handlers.onEvent({ event: "done", data: {} });
      });

    render(<MapWorkspace />);
    await screen.findByText("Home");
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "compare" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByTestId("badge-p1")).toBeInTheDocument();

    // An assistant-driven filter change detaches badges like a user edit would.
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "widen to 1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => {
      expect(screen.queryByTestId("badge-p1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("badge-p2")).not.toBeInTheDocument();
    });
    expect(screen.queryByText("Search radius → 1000 m")).not.toBeInTheDocument();
  });

  // --- Deterministic place-added offers and auto-run behavior ---

  it("offers to pull reports after a pin save, firing no analysis of its own", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValueOnce(makeSummary()).mockResolvedValue(makeSummary([home]));
    vi.mocked(createPlace).mockResolvedValue(home);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Home" } });
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));

    // The direct-report action and Tabby's deterministic offer remain available together
    // in the same rail after saving.
    expect(await screen.findByText("Saved Home. Want me to pull what's on file nearby?")).toBeInTheDocument();
    expect(screen.getByLabelText("Analyst message")).toBeInTheDocument();
    expect(screen.queryByRole("tabpanel", { name: "Compare" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pull reports near Home" })).toBeInTheDocument();
    // Only one saved place → no cross-place compare chip.
    expect(screen.queryByRole("button", { name: /compare with my places/i })).not.toBeInTheDocument();
    // The offer is an invitation, not an analysis — nothing ran.
    expect(analyzePlaces).not.toHaveBeenCalled();
    expect(comparePlaces).not.toHaveBeenCalled();
    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
  });

  it("runs the offer chip as a structured command and hands the row back to the card's chips", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValueOnce(makeSummary()).mockResolvedValue(makeSummary([home]));
    vi.mocked(createPlace).mockResolvedValue(home);
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({
        event: "tool",
        data: {
          tool_name: "analyze_places",
          result: {
            place_ids: ["p1"],
            settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null, layer: "reported" },
            neighborhood: makeNeighborhoodAnalysis(),
            incidents: makeIncidentDetails(),
          },
        },
      });
      onEvent({ event: "token", data: { delta: "Pulled reports near Home." } });
      onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Home" } });
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));

    fireEvent.click(await screen.findByRole("button", { name: "Pull reports near Home" }));

    // The offer chip runs the structured command path with the frozen offer args (never /chat).
    await waitFor(() => expect(streamAssistantCommand).toHaveBeenCalled());
    expect(streamAssistantChat).not.toHaveBeenCalled();
    const payload = vi.mocked(streamAssistantCommand).mock.calls[0][0];
    expect(payload.command).toBe("analyze_places");
    expect(payload.arguments).toEqual({
      place_ids: ["p1"],
      radii_m: [250],
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
      layer: "reported",
    });

    // The offer is consumed: its chip is gone and the landed card's own re-run chips take over.
    await screen.findByText("Pulled reports near Home.");
    expect(screen.queryByRole("button", { name: "Pull reports near Home" })).not.toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Widen to 500 m" })).toBeInTheDocument();
  });

  it("offers a compare after a bulk import of two places, firing no analysis of its own", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValueOnce(makeSummary()).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(createBulkPlaces).mockResolvedValue({ created_count: 2, skipped_count: 0, places: [home, work] });

    render(<MapWorkspace />);
    await screen.findByRole("button", { name: "Add places manually" });
    fireEvent.click(screen.getByRole("button", { name: /add places manually/i }));
    fireEvent.click(screen.getByRole("tab", { name: "Paste list" }));
    fireEvent.change(screen.getByLabelText("Place rows (label, lat, lon)"), {
      target: { value: "display_label,latitude,longitude\nHome,47.61,-122.33\nWork,47.62,-122.34" },
    });
    fireEvent.click(screen.getByRole("button", { name: /import places/i }));

    await screen.findByRole("checkbox", { name: "Select Home" }); // import landed on the manage list
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(await screen.findByText("Saved 2 places. Want me to compare them?")).toBeInTheDocument();
    expect(screen.getByLabelText("Analyst message")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Compare these 2 places" })).toBeInTheDocument();
    expect(analyzePlaces).not.toHaveBeenCalled();
    expect(comparePlaces).not.toHaveBeenCalled();
  });

  it("narrow viewport: an offer minted after a bulk import raises the sheet from bar to half", async () => {
    window.innerWidth = 400;
    localStorage.setItem("compcat.drawer.collapsed", "true");
    localStorage.setItem("compcat.drawer.snap", "bar");
    try {
      vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
      vi.mocked(getDashboardSummary).mockResolvedValueOnce(makeSummary()).mockResolvedValue(makeSummary([home, work]));
      vi.mocked(createBulkPlaces).mockResolvedValue({ created_count: 2, skipped_count: 0, places: [home, work] });

      const { container } = render(<MapWorkspace />);
      await screen.findByRole("button", { name: "Add places manually" });
      expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-bar");

      fireEvent.click(screen.getByRole("button", { name: /add places manually/i }));
      fireEvent.click(screen.getByRole("tab", { name: "Paste list" }));
      fireEvent.change(screen.getByLabelText("Place rows (label, lat, lon)"), {
        target: { value: "display_label,latitude,longitude\nHome,47.61,-122.33\nWork,47.62,-122.34" },
      });
      fireEvent.click(screen.getByRole("button", { name: /import places/i }));

      await screen.findByRole("checkbox", { name: "Select Home" });
      fireEvent.click(screen.getByRole("button", { name: "Close" }));

      expect(await screen.findByText("Saved 2 places. Want me to compare them?")).toBeInTheDocument();
      expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-half");
    } finally {
      localStorage.removeItem("compcat.drawer.collapsed");
      localStorage.removeItem("compcat.drawer.snap");
    }
  });

  it("share-link mount auto-runs exactly once and fires no place-added offer", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());

    const view = encodeView({
      points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
      radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31",
      layer: "reported", offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);

    // The armed auto-run fires exactly once — no double-fire, no offer.
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1));
    await screen.findByText(/shared view/i);
    expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1);
    expect(comparePlaces).not.toHaveBeenCalled();
    expect(screen.queryByText(/want me to pull what's on file/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/want me to compare/i)).not.toBeInTheDocument();
    // It lands as a runId-null analyze card on the rail (no view switch, no export link).
    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());
    expect(screen.queryByText(/details in the card/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("sends unsaved shared pins to Tabby as transient selection and result context", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Downtown", "Capitol Hill"));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(streamAssistantChat).mockResolvedValue(undefined);
    const points = [
      { latitude: 47.606, longitude: -122.332, label: "Downtown" },
      { latitude: 47.612, longitude: -122.319, label: "Capitol Hill" },
    ];
    const view = encodeView({
      points,
      radiusM: 250,
      startDate: "2024-01-01",
      endDate: "2025-12-31",
      layer: "reported",
      offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);

    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Analyst message"), {
      target: { value: "Compare the current pins." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(streamAssistantChat).toHaveBeenCalledTimes(1));
    const payload = vi.mocked(streamAssistantChat).mock.calls[0][0];
    expect(payload.dashboard_state.selected_place_ids).toEqual([]);
    expect(payload.dashboard_state.selected_points).toEqual(points);
    expect(payload.latest_result_context).toEqual(expect.objectContaining({
      kind: "compare",
      place_ids: [],
      points,
    }));
  });

  it("keeps assistant point-backed results out of persistent and selectable place chips", async () => {
    const points = [
      { latitude: 47.606, longitude: -122.332, label: "Assistant point A" },
      { latitude: 47.612, longitude: -122.319, label: "Assistant point B" },
    ];
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({
        event: "tool",
        data: {
          tool_name: "compare_places",
          result: {
            place_ids: [],
            points,
            settings_used: {
              radius_m: 250,
              analysis_start_date: "2024-01-01",
              analysis_end_date: "2024-12-31",
              layer: "reported",
            },
            comparison: makeSiteComparison("Assistant point A", "Assistant point B"),
          },
        },
      });
      handlers.onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "Compare two points" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());
    expect(screen.queryByRole("checkbox", { name: "Assistant point A" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Assistant point B" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Show Assistant point [AB] on map — Unsaved/ })).not.toBeInTheDocument();
  });

  it("promotes a point-backed result to result-aware context after its place is saved", async () => {
    const saved: Place = {
      ...home,
      id: "saved-pike",
      display_label: "Pike Place",
      latitude: 47.61,
      longitude: -122.34,
    };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValue(makeSummary([saved]));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(createPlace).mockResolvedValue(saved);
    vi.mocked(streamAssistantChat).mockResolvedValue(undefined);

    const view = encodeView({
      points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
      radiusM: 250,
      startDate: "2024-01-01",
      endDate: "2024-01-31",
      layer: "reported",
      offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);

    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save Pike Place" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Pike Place" })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );

    fireEvent.change(screen.getByLabelText("Analyst message"), {
      target: { value: "Why wasn't that result statistically clear?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(streamAssistantChat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(streamAssistantChat).mock.calls[0][0].latest_result_context).toEqual({
      kind: "analyze",
      place_ids: ["saved-pike"],
      analysis_start_date: "2024-01-01",
      analysis_end_date: "2024-01-31",
      radius_m: 250,
      offense_category: null,
      offense_subcategory: null,
      nibrs_group: null,
      layer: "reported",
    });
  });

  // The blob has done its job once the view is in state. Leaving it in the address bar means
  // a reload silently re-applies someone else's scope over whatever the user built since.
  it("strips ?view= from the URL once the shared view has loaded, keeping the in-app state", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());

    const view = encodeView({
      points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
      radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31",
      layer: "reported", offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}&keep=1`);
    render(<MapWorkspace />);

    await waitFor(() => expect(new URLSearchParams(window.location.search).get("view")).toBeNull());
    // Only ?view= goes; any other query the user arrived with survives.
    expect(new URLSearchParams(window.location.search).get("keep")).toBe("1");

    // The shared scope itself is untouched: the banner, its Exit affordance and the loaded
    // points all still work off component state rather than the URL.
    expect(await screen.findByText(/shared view/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Exit" })).toBeInTheDocument();
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    await waitFor(() => expect(screen.queryByText(/shared view/i)).not.toBeInTheDocument());
  });

  it("keeps the bad-link warning when ?view= fails to decode, and still strips the param", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    window.history.replaceState({}, "", "/?view=not-a-real-view");
    render(<MapWorkspace />);

    expect(await screen.findByText(/shared link couldn't be opened/i)).toBeInTheDocument();
    await waitFor(() => expect(new URLSearchParams(window.location.search).get("view")).toBeNull());
  });

  it("an address lookup waits for a direct report request and fires no place-added offer", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));

    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1));
    expect(createPlace).not.toHaveBeenCalled();
    expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1);
    expect(comparePlaces).not.toHaveBeenCalled();
    expect(screen.queryByText(/want me to pull what's on file/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/want me to compare/i)).not.toBeInTheDocument();
    // The lookup's auto-run also lands as a runId-null card; step to the rail to read it —
    // an ad-hoc point (no saved place), so its export link is absent.
    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());
    expect(screen.queryByText(/details in the card/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
  });

  it("a requested report whose payload fails appends no card", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    // Both result slices reject, so the run settles with no payload (comparison/neighborhood null).
    vi.mocked(getNeighborhoodAnalysis).mockRejectedValue(new Error("boom"));
    vi.mocked(getIncidentDetails).mockRejectedValue(new Error("boom"));
    vi.mocked(createAnalysisReport).mockRejectedValueOnce(new Error("boom"));
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));

    fireEvent.click(screen.getByRole("button", { name: "Run report" }));
    // Both payload slices reject; wait for the run to have fired and settled.
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getIncidentDetails).toHaveBeenCalledTimes(1));

    // The empty/error path appends nothing: no card and no summary reached the rail thread.
    expect(screen.queryByText(/details in the card/i)).not.toBeInTheDocument();
    expect(document.querySelector(".mc-result-card")).not.toBeInTheDocument();
  });

  it("an assistant result after a failed auto-run lands only the bridge card (no stale local card)", async () => {
    // A failed auto-run leaves the local-card arming pending; the assistant's applyAssistant
    // then writes the SAME result slices the completion effect keys on. The assistant result
    // must disarm the pending card, or a stale LOCAL card would append beside the bridge card.
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(getNeighborhoodAnalysis).mockRejectedValue(new Error("boom"));
    vi.mocked(getIncidentDetails).mockRejectedValue(new Error("boom"));
    vi.mocked(createAnalysisReport).mockRejectedValueOnce(new Error("boom"));
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({
        event: "tool",
        data: {
          tool_name: "analyze_places",
          result: {
            place_ids: ["a"],
            settings_used: { radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-30", offense_category: null },
            neighborhood: makeNeighborhoodAnalysis(),
            incidents: makeIncidentDetails(),
          },
        },
      });
      handlers.onEvent({ event: "token", data: { delta: "Analyzed Alpha." } });
      handlers.onEvent({ event: "done", data: {} });
    });

    const view = encodeView({
      points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
      radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31",
      layer: "reported", offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);

    // The share-link auto-run fires and fails (both payload slices reject → no card lands).
    await screen.findByText(/shared view/i);
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".mc-result-card")).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Exactly ONE card — the bridge's — with only the assistant's summary line; the stale
    // auto-run arming appends no local card or summary.
    await screen.findByText("Analyzed Alpha.");
    expect(document.querySelectorAll(".mc-result-card")).toHaveLength(1);
    expect(screen.queryByText(/details in the card/i)).not.toBeInTheDocument();
  });

  it("an assistant add_place tool event fires no place-added offer (bridge path, not selectPlaceIds)", async () => {
    const created: Place = { ...home, id: "np", display_label: "New Place" };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValueOnce(makeSummary()).mockResolvedValue(makeSummary([created]));
    vi.mocked(streamAssistantChat).mockImplementation(async (_payload, handlers) => {
      handlers.onEvent({ event: "tool", data: { tool_name: "add_place", result: { place: { id: "np" } } } });
      handlers.onEvent({ event: "token", data: { delta: "Added New Place to your list." } });
      handlers.onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "add New Place" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await screen.findByText("Added New Place to your list.");
    // The bridge's add_place never routes through selectPlaceIds, so no offer is minted.
    expect(screen.queryByText(/want me to pull what's on file/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/want me to compare/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pull reports near/i })).not.toBeInTheDocument();
  });

  // --- Shared composer run, copy-link, and export controls ---

  it("the composer Run report action uses dashboard APIs for a single saved place", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());

    render(<MapWorkspace />);
    await screen.findByText("Home");

    const runButton = screen.getByRole("button", { name: "Run report" });
    await waitFor(() => expect(runButton).toBeEnabled());
    fireEvent.click(runButton);

    await waitFor(() => expect(analyzePlaces).toHaveBeenCalled());
    const window = currentYearAnalysisWindow();
    expect(analyzePlaces).toHaveBeenCalledWith(expect.objectContaining({
      place_ids: ["p1"],
      radii_m: [250],
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
    }));
    expect(streamAssistantCommand).not.toHaveBeenCalled();
  });

  it("the composer Run report action uses dashboard APIs for 2+ saved places", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Home", "Work"));

    render(<MapWorkspace />);
    await screen.findByText("Home");

    await waitFor(() => expect(screen.getByRole("button", { name: "Run report" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Run report" }));

    await waitFor(() => expect(comparePlaces).toHaveBeenCalled());
    const window = currentYearAnalysisWindow();
    expect(comparePlaces).toHaveBeenCalledWith(expect.objectContaining({
      points: [
        expect.objectContaining({ label: "Home" }),
        expect.objectContaining({ label: "Work" }),
      ],
      radius_m: 250,
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
    }));
    expect(streamAssistantCommand).not.toHaveBeenCalled();
  });

  it("hides Run report when there are no places", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    expect(screen.queryByRole("button", { name: "Run report" })).not.toBeInTheDocument();
  });

  it("ContextStrip Copy link writes the share URL and flashes Copied", async () => {
    const preciseHome = { ...home, latitude: 47.6123456, longitude: -122.3345678 };
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([preciseHome]));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    await waitFor(() => expect(screen.getByRole("button", { name: "Copy link" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copiedUrl = new URL(writeText.mock.calls[0][0]);
    const sharedView = decodeView(copiedUrl.searchParams.get("view") ?? "");
    expect(sharedView?.points[0]).toMatchObject({
      latitude: 47.6123456,
      longitude: -122.3345678,
    });
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("Manage modal export toggle calls updatePlace with the export sensitivity class", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(updatePlace).mockResolvedValue(home);

    render(<MapWorkspace />);
    await screen.findByText("Home");
    fireEvent.click(screen.getByRole("button", { name: "Manage places" }));
    await screen.findByRole("dialog", { name: "Manage places" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Include Home in export" }));
    await waitFor(() => expect(updatePlace).toHaveBeenCalledWith("p1", { sensitivity_class: "suppress_from_public_export" }));
  });

  it("Manage modal footer links to the dashboard's session export href", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);
    await screen.findByText("Home");
    fireEvent.click(screen.getByRole("button", { name: "Manage places" }));
    await screen.findByRole("dialog", { name: "Manage places" });

    expect(screen.getByRole("link", { name: "Export session CSV" })).toHaveAttribute("href", "/exports/current.csv");
  });

  it("opens the About panel from the topbar and closes it on Escape", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    expect(screen.queryByRole("dialog", { name: "About CompCat" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "About CompCat" }));
    expect(screen.getByRole("dialog", { name: "About CompCat" })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "About CompCat" })).not.toBeInTheDocument();
  });

  it("narrow viewport: the About button stays in the topbar beside the theme toggle", async () => {
    window.innerWidth = 375;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    const { container } = render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    const right = container.querySelector(".mc-topbar-right")!;
    expect(within(right as HTMLElement).getByRole("button", { name: "About CompCat" })).toBeInTheDocument();
    expect(within(right as HTMLElement).getByRole("button", { name: /Switch to .* theme/ })).toBeInTheDocument();
  });

  // The legend was display:none under the mobile breakpoint, so phone users had no way to
  // read what the pins, rings and dots meant.
  async function renderForMapKey(innerWidth: number) {
    window.innerWidth = innerWidth;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
  }

  it("narrow viewport: the map key sits behind a toggle that opens and closes it", async () => {
    await renderForMapKey(375);

    const toggle = screen.getByRole("button", { name: "Map key" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "mc-map-legend");
    expect(screen.getByText("Saved place")).not.toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    // Same legend, unchanged: every marker row is there once opened.
    expect(screen.getByText("Saved place")).toBeVisible();
    expect(screen.getByText("Selected")).toBeVisible();
    expect(screen.getByText("Low data")).toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Saved place")).not.toBeVisible();
  });

  it("narrow viewport: Escape closes the open map key and returns focus to its toggle", async () => {
    await renderForMapKey(375);

    const toggle = screen.getByRole("button", { name: "Map key" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
  });

  it("wide viewport: the map key stays behind the same compact toggle", async () => {
    await renderForMapKey(1024);

    const toggle = screen.getByRole("button", { name: "Map key" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Saved place")).not.toBeVisible();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Saved place")).toBeVisible();
  });
});

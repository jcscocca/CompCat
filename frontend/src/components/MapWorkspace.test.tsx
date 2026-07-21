// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  MapCanvas: ({ places, selectedIds, draft, flyTo, fitTo, badgedPlaceIds, onMapClick, onMarkerClick, onBadgeClick }: any) => {
    if (flyToCaptures[flyToCaptures.length - 1] !== flyTo) flyToCaptures.push(flyTo);
    if (fitToCaptures[fitToCaptures.length - 1] !== fitTo) fitToCaptures.push(fitTo);
    canvasCaptures.push({ places, selectedIds });
    return (
      <div data-testid="mapcanvas">
        <button data-testid="fire-map-click" onClick={() => onMapClick({ lat: 47.6, lng: -122.3 })} />
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

vi.mock("../api/client", () => ({
  analyzePlaces: vi.fn(),
  comparePlaces: vi.fn(),
  createBulkPlaces: vi.fn(),
  createPlace: vi.fn(),
  createSession: vi.fn(),
  deletePlace: vi.fn(),
  getBeatPolygons: vi.fn().mockResolvedValue({ type: "FeatureCollection", features: [] }),
  getIncidentDetails: vi.fn(),
  getIncidentPoints: vi.fn().mockResolvedValue({
    points: [], returned_count: 0, total_count: 0, unmappable_citywide_count: 0, limit: 5000,
  }),
  getMcppPolygons: vi.fn().mockResolvedValue({ type: "FeatureCollection", features: [] }),
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
import { analyzePlaces, comparePlaces, createBulkPlaces, createPlace, createSession, deletePlace, getDashboardFreshness, getDashboardSummary, getIncidentDetails, getNeighborhoodAnalysis, streamAssistantChat, streamAssistantCommand, updatePlace } from "../api/client";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import { snapHeightPx } from "../lib/drawer";
import { encodeView } from "../lib/savedView";
import { keyOf } from "../lib/useAddressList";
import type { DashboardFreshness, DashboardSummary, IncidentDetailsResponse, NeighborhoodAnalysis, Place, SiteComparison } from "../types";

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

function makeSiteComparison(aLabel: string, bLabel: string): SiteComparison {
  const opt = (id: string, label: string, count: number, rate: number) => ({ id, label, geometry_type: "place_buffer", radius_m: 250, incident_count: count, exposure: 1, exposure_unit: "square_km_days", incident_rate: rate });
  const options = [opt("a", aLabel, 12, 3.9), opt("b", bLabel, 44, 14.3)];
  return {
    id: "c1", comparison_type: "site", geometry_type: "place_buffer", radius_m: 250,
    analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
    offense_category: null, offense_subcategory: null, nibrs_group: null, created_at: "2026-07-03",
    overview: { label: "Overview", decision_class: "statistically_lower", recommendation_option_id: "a", recommendation_label: aLabel, summary_text: "", caveat_text: "cav", options },
    analytical: { label: "Analytical", source_dataset: "seattle_spd_crime", exposure_unit: "square_km_days", full_caveat_text: "full cav", options, pairwise_results: [{ id: "a-b", option_a_id: "a", option_a_label: aLabel, option_b_id: "b", option_b_label: bLabel, winner_option_id: "a", winner_label: aLabel, decision_class: "statistically_lower", method: "quasipoisson", incident_count_a: 12, incident_count_b: 44, exposure_a: 1, exposure_b: 1, exposure_unit: "square_km_days", rate_a: 3.9, rate_b: 14.3, rate_ratio: 3.7, ci_lower: 2.0, ci_upper: 6.8, p_value: 0.001, adjusted_p_value: 0.004, overdispersion_phi: 1.1, overdispersion_status: "ok", minimum_data_status: "met", caveat_text: "" }] },
  };
}

beforeEach(() => {
  // Clear the stored theme and the document attribute so the toggle test
  // doesn't inherit prior-test state; clear all storage so the persisted
  // `compcat.selection` key never leaks between tests.
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  // jsdom has no scrollIntoView; the rail's focus-card effect calls it. Fresh stub per test.
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(getDashboardFreshness).mockResolvedValue(null as unknown as DashboardFreshness);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.removeItem("compcat.theme");
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
    expect(screen.getByRole("button", { name: /arrests/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /911 calls/i })).toBeDisabled();
  });

  it("uses header actions for desktop width and collapse, then restores the prior width", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    const { container } = render(<MapWorkspace />);
    await screen.findByText("Home");
    const panel = () => container.querySelector(".mc-workspace-panel") as HTMLElement;

    expect(screen.queryByRole("group", { name: "Panel size" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use wide pane width" }));
    expect(panel().style.width).toBe("640px");
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
        display_label: "Test location",
        latitude: 47.6,
        longitude: -122.3,
        visit_count: 1,
        sensitivity_class: "normal",
      });
    });
  });

  it("selects a newly saved pin so analysis can run without manual selection", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValue(makeSummary([home]));
    vi.mocked(createPlace).mockResolvedValue(home);
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => { onEvent({ event: "done", data: {} }); });

    render(<MapWorkspace />);
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

    // A manual save is an edit, so it waits for Run — no premature auto-run fires. The saved
    // pin is auto-selected, so the rail's Run analysis sends its id via the command path.
    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));

    await waitFor(() => expect(streamAssistantCommand).toHaveBeenCalled());
    const payload = vi.mocked(streamAssistantCommand).mock.calls[0][0];
    expect(payload.command).toBe("analyze_places");
    expect(payload.arguments).toEqual(expect.objectContaining({
      place_ids: ["p1"],
      radii_m: [250],
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
      layer: "reported",
    }));
  });

  it("selects bulk imported places so analysis can run without manual selection", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValue(makeSummary([home, work]));
    vi.mocked(createBulkPlaces).mockResolvedValue({ created_count: 2, skipped_count: 0, places: [home, work] });
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => { onEvent({ event: "done", data: {} }); });

    render(<MapWorkspace />);
    await screen.findByRole("button", { name: "Add places manually" });

    fireEvent.click(screen.getByRole("button", { name: /add places manually/i }));
    fireEvent.click(screen.getByRole("button", { name: "Bulk CSV" }));
    fireEvent.change(screen.getByLabelText("CSV rows"), {
      target: { value: "display_label,latitude,longitude\nHome,47.61,-122.33\nWork,47.62,-122.34" },
    });
    fireEvent.click(screen.getByRole("button", { name: /import rows/i }));

    expect(await screen.findByRole("checkbox", { name: "Select Home" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Select Work" })).toHaveAttribute("aria-checked", "true");

    // Importing is an edit, so it waits for Run — no premature auto-run fires. Both imported
    // places are auto-selected; the rail's Run analysis compares them (2+ saved → compare).
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));

    await waitFor(() => expect(streamAssistantCommand).toHaveBeenCalled());
    const payload = vi.mocked(streamAssistantCommand).mock.calls[0][0];
    expect(payload.command).toBe("compare_places");
    expect(payload.arguments).toEqual(expect.objectContaining({
      place_ids: ["p1", "p2"],
      radius_m: 250,
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
      layer: "reported",
    }));
  });

  it("closes the manage modal when its address search hands off to the draft flow", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    geocodeSearch.mockResolvedValue([{ label: "500 Pine St", latitude: 47.615, longitude: -122.335, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    expect(screen.getByRole("dialog", { name: "Manage places" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search an address or place"), { target: { value: "500 Pine" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByText("500 Pine St"));

    // The scrim would hide the draft popover, so the handoff must close the modal first.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // The draft's save popover renders on the rail (drawer top slot), not a legacy panel.
    expect(await screen.findByRole("button", { name: /save pin/i })).toBeInTheDocument();
  });

  it("surfaces a failed rename as an alert on the rail", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(updatePlace).mockRejectedValue(new Error("boom"));

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
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
    expect(screen.getByLabelText(/label/i)).toBeInTheDocument();
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
    expect(await screen.findByText("100 block of Main St")).toBeInTheDocument();
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

    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));

    expect(screen.queryByText("Search radius → 500 m")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "500 m" })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows an error when the session cannot start", async () => {
    vi.mocked(createSession).mockRejectedValue(new Error("no session"));
    render(<MapWorkspace />);
    // Rendered by both error surfaces in an empty app: the map banner and the rail alert.
    const alerts = await screen.findAllByText(/unable to start a dashboard session/i);
    expect(alerts.length).toBeGreaterThan(1);
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

    // The turn completes and the bridge applies its effect without bouncing to the
    // Compare view — the composer stays put. (Card-content assertions land in Task 6.)
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
    // The turn completes without bouncing to the Compare view — the composer stays put.
    // (Card-content assertions land in Task 6.)
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
    expect(await screen.findByTestId("compare-callout")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
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

  it("looks up an address and analyzes it via the points path without saving a place", async () => {
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
    // An ad-hoc lookup runs the inline-points path; no place is saved, so the place_ids
    // summary-refresh pass is skipped entirely.
    await waitFor(() => {
      expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(expect.objectContaining({
        points: [{ latitude: 47.61, longitude: -122.34, label: "123 Main St" }],
        radii_m: [250],
        layer: "reported",
      }));
    });
    expect(analyzePlaces).not.toHaveBeenCalled();
    expect(createPlace).not.toHaveBeenCalled();
    // Incident details live in the local card's expanded view on the rail.
    fireEvent.click(await screen.findByRole("button", { name: "View details" }));
    expect(await screen.findByText("100 block of Main St")).toBeInTheDocument();
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

    render(<MapWorkspace />);
    await screen.findByText("Home");

    const group = screen.getByRole("group", { name: "Data layer" });
    expect(group.closest(".mc-workspace-panel")).not.toBeNull();
    expect(group.closest(".mc-topbar")).toBeNull();
  });

  it("wide viewport: the layer toggle mounts in the top bar", async () => {
    window.innerWidth = 1200;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);
    await screen.findByText("Home");

    const group = screen.getByRole("group", { name: "Data layer" });
    expect(group.closest(".mc-topbar")).not.toBeNull();
    expect(group.closest(".mc-workspace-panel")).toBeNull();
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
    // No view switch: the composer stays on the rail. (Card-content assertions land in Task 6.)
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

    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage places" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Remove Home" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));

    // handleDelete drops the deleted place's entry from the one address list, so its chip
    // deselects while the surviving place's chip stays checked.
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.getByRole("checkbox", { name: "Work" })).toHaveAttribute("aria-checked", "true");
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
    expect(screen.getByRole("button", { name: "Show 500 Pine St on map" })).toHaveTextContent("Unsaved");
    expect(screen.getByRole("button", { name: "Remove 500 Pine St from analysis" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save pin/i })).toBeInTheDocument();
  });

  it("marks the current card as previous analysis when filters change", async () => {
    localStorage.setItem("compcat.selection", JSON.stringify([home.id]));
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());

    render(<MapWorkspace />);
    await waitFor(() => expect(document.querySelector(".mc-result-card")).toBeInTheDocument());
    expect(screen.getByText("Analysis result")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));

    expect(screen.getByText("Previous analysis")).toBeInTheDocument();
    expect(document.querySelector(".mc-result-card")).toHaveClass("is-historical");
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
    await screen.findByRole("checkbox", { name: home.display_label });

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

  it("does not double-run when a lookup fires before places finish loading", async () => {
    let resolveSummary!: (value: DashboardSummary) => void;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockReturnValue(new Promise<DashboardSummary>((resolve) => { resolveSummary = resolve; }));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    // Fire a search-pill lookup before the dashboard summary resolves.
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));

    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1));

    // Places arrive after the lookup edit; the restore greet must not fire a second run.
    resolveSummary(makeSummary([home]));
    await screen.findByRole("checkbox", { name: "Home" });
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
    // own summary refetch delivers it. (This used to also assert the applied comparison
    // pane survived the resolve-append; that's only observable via the Compare tab, which
    // assistant flows no longer switch to — pane-survival coverage returns with the
    // AnalysisCard render in Task 6.)
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

    // The update_filters effect updates the single filter control without adding a
    // duplicate transcript line or leaving the rail.
    await waitFor(() => expect(screen.getByRole("button", { name: /analysis context filters/i })).toHaveAccessibleName(/500 m/));
    expect(screen.queryByText("Search radius → 500 m")).not.toBeInTheDocument();
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

    // Filters are not gated by offline, and the change stays in the single filter control.
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(screen.getByRole("button", { name: "500 m" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("Search radius → 500 m")).not.toBeInTheDocument();
  });

  // --- Slice 3 Task 6: cards in the thread + follow-up chips + width toggle + export base ---

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
    expect(widthNow()).toBe("640px");
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(widthNow()).toBe("400px");
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
    const link = screen.getByRole("link", { name: "Export CSV" });
    expect(link.getAttribute("href")).toContain("run_id=run-xyz");
  });

  // --- Slice 4 Task 4: presence badges → focus-card + fit-on-analysis ---

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
    await waitFor(() => expect(scrollSpy).toHaveBeenCalledWith({ behavior: "smooth", block: "center" }));
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
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
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
    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage places" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Remove Home" }));

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

  // --- Slice 5 Task 2: deterministic place-added offers + auto-run audit ---

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

    // The proactive moment must be SEEN when it fires: the offer-bearing add lands on the
    // rail — offer text, chip, and composer visible immediately, no view switch needed. It
    // survives its own add (set AFTER selectPlaceIds' invalidateAnalysisContext clears it).
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

    // The offer-bearing add lands on the rail, so the chip is clickable immediately.
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
    fireEvent.click(screen.getByRole("button", { name: "Bulk CSV" }));
    fireEvent.change(screen.getByLabelText("CSV rows"), {
      target: { value: "display_label,latitude,longitude\nHome,47.61,-122.33\nWork,47.62,-122.34" },
    });
    fireEvent.click(screen.getByRole("button", { name: /import rows/i }));

    await screen.findByRole("checkbox", { name: "Select Home" }); // import landed on the manage list
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    // The offer-bearing import lands on the rail — offer and composer visible immediately.
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
      fireEvent.click(screen.getByRole("button", { name: "Bulk CSV" }));
      fireEvent.change(screen.getByLabelText("CSV rows"), {
        target: { value: "display_label,latitude,longitude\nHome,47.61,-122.33\nWork,47.62,-122.34" },
      });
      fireEvent.click(screen.getByRole("button", { name: /import rows/i }));

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

  it("an address lookup auto-runs once and fires no place-added offer (no place saved)", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));

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

  it("an auto-run whose payload fails appends no card and no summary to the rail", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    // Both result slices reject, so the run settles with no payload (comparison/neighborhood null).
    vi.mocked(getNeighborhoodAnalysis).mockRejectedValue(new Error("boom"));
    vi.mocked(getIncidentDetails).mockRejectedValue(new Error("boom"));
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);
    fireEvent.change(screen.getByRole("combobox", { name: /search address or place/i }), { target: { value: "123 Main" } });
    fireEvent.click(await screen.findByRole("option", { name: "123 Main St" }));

    // The auto-run's payload slices both reject; wait for the run to have fired and settled.
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

  // --- Slice 7 Task 2: rehomed run/copy-link/export controls ---

  it("ContextStrip Run analysis runs analyze_places for a single saved place", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    const runButton = screen.getByRole("button", { name: "Run analysis" });
    expect(runButton).toBeEnabled();
    fireEvent.click(runButton);

    await waitFor(() => expect(streamAssistantCommand).toHaveBeenCalled());
    const window = currentYearAnalysisWindow();
    const payload = vi.mocked(streamAssistantCommand).mock.calls[0][0];
    expect(payload.command).toBe("analyze_places");
    expect(payload.arguments).toEqual(expect.objectContaining({
      place_ids: ["p1"],
      radii_m: [250],
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
    }));
  });

  it("ContextStrip Run analysis runs compare_places for 2+ saved places", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));

    await waitFor(() => expect(streamAssistantCommand).toHaveBeenCalled());
    const window = currentYearAnalysisWindow();
    const payload = vi.mocked(streamAssistantCommand).mock.calls[0][0];
    expect(payload.command).toBe("compare_places");
    expect(payload.arguments).toEqual(expect.objectContaining({
      place_ids: ["p1", "p2"],
      radius_m: 250,
      analysis_start_date: window.analysis_start_date,
      analysis_end_date: window.analysis_end_date,
    }));
  });

  it("ContextStrip Run analysis is disabled with no saved places", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    render(<MapWorkspace />);
    await screen.findByText(/point me at a place/i);

    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    expect(screen.getByRole("button", { name: "Run analysis" })).toBeDisabled();
  });

  it("ContextStrip Copy link writes the share URL and flashes Copied", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain("?view=");
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("Manage modal export toggle calls updatePlace with the export sensitivity class", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(updatePlace).mockResolvedValue(home);

    render(<MapWorkspace />);
    await screen.findByText("Home");
    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    await screen.findByRole("dialog", { name: "Manage places" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Include Home in export" }));
    await waitFor(() => expect(updatePlace).toHaveBeenCalledWith("p1", { sensitivity_class: "suppress_from_public_export" }));
  });

  it("Manage modal footer links to the dashboard's Tableau export href", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);
    await screen.findByText("Home");
    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    await screen.findByRole("dialog", { name: "Manage places" });

    expect(screen.getByRole("link", { name: /download tableau csv/i })).toHaveAttribute("href", "/exports/current.csv");
  });
});

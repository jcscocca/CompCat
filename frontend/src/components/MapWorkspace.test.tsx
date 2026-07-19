// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Captures each distinct flyTo reference MapCanvas receives — the real MapCanvas re-flies
// on reference change, so the capture list mirrors the fly sequence the map would perform.
const flyToCaptures = vi.hoisted(() => [] as ({ lat: number; lng: number } | null)[]);
// Captures the places + selectedIds MapCanvas receives each render, so tests can assert the
// synthetic ad-hoc pins MapWorkspace appends (mirrors the flyToCaptures pattern above).
const canvasCaptures = vi.hoisted(() => [] as { places: unknown[]; selectedIds: Set<string> }[]);
vi.mock("./MapCanvas", () => ({
  MapCanvas: ({ places, selectedIds, draft, flyTo, onMapClick, onMarkerClick }: any) => {
    if (flyToCaptures[flyToCaptures.length - 1] !== flyTo) flyToCaptures.push(flyTo);
    canvasCaptures.push({ places, selectedIds });
    return (
      <div data-testid="mapcanvas">
        <button data-testid="fire-map-click" onClick={() => onMapClick({ lat: 47.6, lng: -122.3 })} />
        {draft ? <div data-testid="draft-pin" /> : null}
        {places.map((place: any) => (
          <button key={place.id} data-testid={`marker-${place.id}`} onClick={() => onMarkerClick(place.id)} />
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
import { analyzePlaces, comparePlaces, createBulkPlaces, createPlace, createSession, deletePlace, getDashboardSummary, getIncidentDetails, getMcppPolygons, getNeighborhoodAnalysis, streamAssistantChat, streamAssistantCommand, updatePlace } from "../api/client";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import { encodeView } from "../lib/savedView";
import { keyOf } from "../lib/useAddressList";
import type { DashboardSummary, IncidentDetailsResponse, NeighborhoodAnalysis, Place, SiteComparison } from "../types";

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
  canvasCaptures.length = 0;
});

describe("MapWorkspace", () => {
  // Rail-first drawer: legacy panels live behind the overflow menu; Tabby is home.
  function openLegacyView(name: "Compare" | "Export") {
    fireEvent.click(screen.getByRole("button", { name: "More panels" }));
    fireEvent.click(screen.getByRole("menuitem", { name: new RegExp(name, "i") }));
  }
  // The assistant input lives on the Tabby rail, but analysis flows (auto-run, lookup,
  // bridge effects) open the Compare panel — step back to Tabby to reach the composer.
  async function backToTabby() {
    fireEvent.click(await screen.findByRole("button", { name: "Back to Tabby" }));
  }

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
    await screen.findByRole("heading", { name: /look up an address/i });

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

    render(<MapWorkspace />);
    await screen.findByRole("heading", { name: /look up an address/i });

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Home" } });
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));

    // The saved pin lands in the one address list as a selected (saved) entry — its chip
    // renders WITHIN the Compare panel (as its topSlot), checked.
    await waitFor(() => {
      const comparePanel = screen.getByRole("tabpanel", { name: "Compare" });
      expect(within(comparePanel).getByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "true");
    });

    // A manual save is an edit, so it waits for Run — no premature auto-run fires. Running
    // then sends the saved place's id on the place_ids summary-refresh pass.
    const runButton = await screen.findByRole("button", { name: /run analysis/i });
    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
    fireEvent.click(runButton);

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

  it("selects bulk imported places so analysis can run without manual selection", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValue(makeSummary([home, work]));
    vi.mocked(createBulkPlaces).mockResolvedValue({ created_count: 2, skipped_count: 0, places: [home, work] });
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });

    render(<MapWorkspace />);
    await screen.findByRole("heading", { name: /look up an address/i });

    fireEvent.click(screen.getByRole("button", { name: /add places manually/i }));
    fireEvent.click(screen.getByRole("button", { name: "Bulk CSV" }));
    fireEvent.change(screen.getByLabelText("CSV rows"), {
      target: { value: "display_label,latitude,longitude\nHome,47.61,-122.33\nWork,47.62,-122.34" },
    });
    fireEvent.click(screen.getByRole("button", { name: /import rows/i }));

    expect(await screen.findByRole("checkbox", { name: "Select Home" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Select Work" })).toHaveAttribute("aria-checked", "true");

    // Importing is an edit, so it waits for Run — no premature auto-run fires. Two
    // entries → the compare CTA.
    const runButton = await screen.findByRole("button", { name: /compare 2 addresses/i });
    expect(getNeighborhoodAnalysis).not.toHaveBeenCalled();
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledWith({
        place_ids: ["p1", "p2"],
        analysis_start_date: window.analysis_start_date,
        analysis_end_date: window.analysis_end_date,
        radii_m: [250],
        offense_category: null,
        layer: "reported",
      });
    });
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
    const comparePanel = screen.getByRole("tabpanel", { name: "Compare" });
    expect(within(comparePanel).getByRole("button", { name: /save pin/i })).toBeInTheDocument();
  });

  it("surfaces an error when a rename fails", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(updatePlace).mockRejectedValue(new Error("boom"));

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    fireEvent.click(screen.getByRole("button", { name: "Rename Home" }));
    const input = screen.getByRole("textbox", { name: "New name for Home" });
    fireEvent.change(input, { target: { value: "Home base" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(await screen.findByText("Unable to rename place. Try again.")).toBeInTheDocument();
  });

  it("marks the frame is-focus only when the drawer leaves less than the chrome minimum", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());

    try {
      // Default width (400) leaves a 624px strip at jsdom's 1024 viewport — chrome stays.
      const wide = render(<MapWorkspace />);
      await screen.findByRole("heading", { name: /look up an address/i });
      expect(wide.container.querySelector(".mc-frame")).not.toHaveClass("is-focus");
      wide.unmount();

      // A 900px drawer leaves a 124px strip (< FOCUS_CHROME_MIN 240) — chrome sheds.
      localStorage.setItem("compcat.drawer.width", "900");
      const focus = render(<MapWorkspace />);
      await screen.findByRole("heading", { name: /look up an address/i });
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
    await screen.findByRole("heading", { name: /look up an address/i });

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));

    expect(container.querySelector(".mc-frame")).toHaveClass("is-placing-pin");
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-collapsed");
    expect(container.querySelector(".mc-sheet")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("fire-map-click"));

    expect(container.querySelector(".mc-frame")).not.toHaveClass("is-placing-pin");
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-open");
    expect(screen.getByLabelText(/label/i)).toBeInTheDocument();
  });

  it("runs analysis for a selected place", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    // The restored selection (all places) auto-runs on load; clear that call so the manual
    // run below is what the payload assertion verifies. Home is already selected.
    await waitFor(() => expect(analyzePlaces).toHaveBeenCalled());
    vi.mocked(analyzePlaces).mockClear();

    fireEvent.click(await screen.findByRole("button", { name: /run analysis/i }));

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
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());

    render(<MapWorkspace />);
    await screen.findByText("Home");

    // Auto-run greets on load and fetches incident details; clear that call so the manual
    // run below is what the payload assertion verifies. Home is already selected.
    await waitFor(() => expect(getIncidentDetails).toHaveBeenCalled());
    vi.mocked(getIncidentDetails).mockClear();

    fireEvent.click(await screen.findByRole("button", { name: /run analysis/i }));

    // The unified run sends inline points (not place_ids) to the incident-details endpoint.
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

    // Auto-run greets on load and fetches the neighborhood slice; clear that call so the
    // manual run below is what the payload assertion verifies. Home is already selected.
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalled());
    vi.mocked(getNeighborhoodAnalysis).mockClear();

    fireEvent.click(await screen.findByRole("button", { name: /run analysis/i }));

    // The unified run sends inline points (not place_ids) to the neighborhood endpoint.
    await waitFor(() => {
      expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ points: [expect.objectContaining({ label: "Home" })], radii_m: [250] }),
      );
    });
  });

  it("clears stale incident details when analysis controls change", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());

    render(<MapWorkspace />);
    await screen.findByText("Home");

    // Auto-run greets on load and renders incident details for the restored selection.
    expect(await screen.findByText("100 block of Main St")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "500 m" }));

    expect(screen.queryByText("100 block of Main St")).not.toBeInTheDocument();
  });

  it("appends exactly one receipt per filter change under StrictMode", async () => {
    // Guards updater purity: StrictMode double-invokes setAnalysis updaters in dev, so a
    // thread.append inside the updater would duplicate every receipt. The append must
    // stay hoisted into the event handler (see handleAnalysisChange).
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });

    render(<StrictMode><MapWorkspace /></StrictMode>);
    await screen.findByText("Home");
    await backToTabby();

    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));

    expect(screen.getAllByText("Search radius → 500 m")).toHaveLength(1);
  });

  it("shows an error when the session cannot start", async () => {
    vi.mocked(createSession).mockRejectedValue(new Error("no session"));
    render(<MapWorkspace />);
    expect(await screen.findByText(/unable to start a dashboard session/i)).toBeInTheDocument();
  });

  it("opens the Compare tab with the overview when the assistant returns compare_places", async () => {
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
    await backToTabby();

    fireEvent.change(screen.getByLabelText("Analyst message"), {
      target: { value: "compare Alpha and Bravo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Only resolves if the bridge replaced the selection (so CompareTab has 2 places),
    // set the comparison, and switched to the Compare tab.
    expect(await screen.findByTestId("compare-ranked")).toBeInTheDocument();
  });

  it("renders assistant analyze_places incidents on the Compare surface", async () => {
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
    await backToTabby();
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("100 block of Main St")).toBeInTheDocument();
    // analyze_places lands on the Compare surface without firing a cross-address comparison.
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
    // The shared Compare pane renders its verdict (synthetic selection ≥ 2).
    expect(await screen.findByTestId("compare-ranked")).toBeInTheDocument();
  });

  it("leads a fresh session with the look-up landing", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    render(<MapWorkspace />);
    expect(await screen.findByRole("heading", { name: /look up an address/i })).toBeInTheDocument();
    expect(screen.queryByText(/Map your places/i)).not.toBeInTheDocument();
  });

  it("looks up an address and analyzes it via the points path without saving a place", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByRole("heading", { name: /look up an address/i });
    fireEvent.change(screen.getByLabelText(/search an address/i), { target: { value: "123 Main" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByText("123 Main St"));

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
    expect(await screen.findByText("100 block of Main St")).toBeInTheDocument();
  });

  it("lets a later search recenter supersede the last chip fly", async () => {
    flyToCaptures.length = 0;
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    // A verdict card with a locator chip needs a neighborhood place + MCPP geometry.
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue({
      ...makeNeighborhoodAnalysis(),
      places: [{
        place_id: "lookup-0", place_label: "123 Main St", beat: "M2", radius_m: 250,
        baseline_available: false, decision: "baseline_unavailable", place_incident_count: 1,
        place_rate: 0.5, place_rate_ci_lower: 0.3, place_rate_ci_upper: 0.8,
        minimum_data_status: "met", nearest_incident_m: null, monthly_counts: [],
        category_breakdown: [], baselines: [],
      }],
    });
    vi.mocked(getMcppPolygons).mockResolvedValueOnce({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { mcpp: "DOWNTOWN" },
        geometry: { type: "Polygon", coordinates: [[[-122.4, 47.5], [-122.3, 47.5], [-122.3, 47.7], [-122.4, 47.7], [-122.4, 47.5]]] },
      }],
    });
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByRole("heading", { name: /look up an address/i });
    fireEvent.change(screen.getByLabelText(/search an address/i), { target: { value: "123 Main" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByText("123 Main St"));

    // The lookup itself flies the map to the looked-up address (pinDraft.flyTo).
    await waitFor(() => {
      expect(flyToCaptures[flyToCaptures.length - 1]).toEqual({ lat: 47.61, lng: -122.34 });
    });

    // Clicking the chip hands MapCanvas a FRESH flyTo reference for the place's coords
    // (the real MapCanvas re-flies on reference change, even to the same spot).
    const capturesBeforeChip = flyToCaptures.length;
    fireEvent.click(await screen.findByRole("button", { name: "Fly the map to A" }));
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

  it("bridges a looked-up address into the Compare tab as the anchor", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    geocodeSearch.mockResolvedValue([{ label: "123 Main St", latitude: 47.61, longitude: -122.34, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByRole("heading", { name: /look up an address/i });
    fireEvent.change(screen.getByLabelText(/search an address/i), { target: { value: "123 Main" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByText("123 Main St"));

    // The lookup lands directly on the unified Compare surface with the address as row 1;
    // there is no separate "compare with another address" bridge anymore.
    expect(await screen.findByRole("heading", { name: "Compare addresses" })).toBeInTheDocument();
    const list = screen.getByRole("list", { name: /addresses to compare/i });
    expect(within(list).getByText("123 Main St")).toBeInTheDocument();
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
    await screen.findByRole("heading", { name: /look up an address/i });
    fireEvent.change(screen.getByLabelText(/search an address/i), { target: { value: "123 Main" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByText("123 Main St"));

    // The lookup's analysis has rendered before we save.
    expect(await screen.findByText("100 block of Main St")).toBeInTheDocument();
    // The looked-up address is row 1 of the list; its row-level Save persists it.
    fireEvent.click(await screen.findByRole("button", { name: /^save$/i }));

    await waitFor(() => {
      expect(createPlace).toHaveBeenCalledWith({
        display_label: "123 Main St",
        latitude: 47.61,
        longitude: -122.34,
        visit_count: 1,
        sensitivity_class: "normal",
      });
    });
    // Saving stamps the savedPlaceId onto the existing entry in place (markSaved, no
    // invalidation), so the context computed for the same coordinates stays on screen.
    expect(screen.getByText("100 block of Main St")).toBeInTheDocument();
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
    await screen.findByRole("heading", { name: /look up an address/i });
    fireEvent.change(screen.getByLabelText(/search an address/i), { target: { value: "123 Main" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByText("123 Main St"));
    expect(await screen.findByTestId("draft-pin")).toBeInTheDocument();

    // The assistant now takes over the pane with a different selection; the ephemeral lookup
    // (and its draft pin) must be dropped so it no longer shadows the assistant's subject.
    await backToTabby();
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.queryByTestId("draft-pin")).not.toBeInTheDocument());
  });

  it("auto-runs analysis on load with the restored selection", async () => {
    localStorage.setItem("compcat.selection", JSON.stringify([home.id]));
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });

    render(<MapWorkspace />);

    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledTimes(1);
      expect(analyzePlaces).toHaveBeenCalledWith(
        expect.objectContaining({ place_ids: [home.id] }),
      );
    });
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

    await screen.findByRole("heading", { name: /look up an address/i });
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
    const list = screen.getByRole("list", { name: /addresses to compare/i });
    expect(within(list).getByText("Pike Place")).toBeInTheDocument();
    expect(within(list).getByText(home.display_label)).toBeInTheDocument();
    expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(1);

    // Running the two-address list is what triggers the next fetch.
    fireEvent.click(screen.getByRole("button", { name: /compare 2 addresses/i }));
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledTimes(2));
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

  it("legacy 1-point analyze share link lands on the unified Compare surface and auto-runs", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([]));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    const legacy = btoa(unescape(encodeURIComponent(JSON.stringify({
      v: 1, t: "analyze", r: 250, s: "2026-01-01", e: "2026-06-24", ly: "reported",
      pts: [{ y: 47.61, x: -122.33, l: "Shared spot" }], c: null,
    })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    window.history.replaceState(null, "", `/?view=${legacy}`);
    render(<MapWorkspace />);
    expect(await screen.findByRole("tabpanel", { name: "Compare" })).toBeInTheDocument();
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(expect.objectContaining({
      points: [expect.objectContaining({ label: "Shared spot" })],
    })));
    expect(comparePlaces).not.toHaveBeenCalled();
  });

  it("applies an assistant analyze_places context module onto the Compare surface", async () => {
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
    await backToTabby();
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const comparePanel = await screen.findByRole("tabpanel", { name: "Compare" });
    expect(await within(comparePanel).findByLabelText("Context for Alpha")).toBeInTheDocument();
    expect(comparePlaces).not.toHaveBeenCalled();
  });

  it("deleting a saved place removes its address-list row", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(deletePlace).mockResolvedValue(undefined);

    render(<MapWorkspace />);
    const list = await screen.findByRole("list", { name: /addresses to compare/i });
    expect(within(list).getByText("Home")).toBeInTheDocument();
    expect(within(list).getByText("Work")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add or manage places" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage places" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Remove Home" }));

    // handleDelete drops the deleted place's entry from the one address list, so its row
    // disappears while the surviving place's row stays.
    await waitFor(() => {
      const rows = screen.getByRole("list", { name: /addresses to compare/i });
      expect(within(rows).queryByText("Home")).not.toBeInTheDocument();
      expect(within(rows).getByText("Work")).toBeInTheDocument();
    });
  });

  it("synthesizes lettered pins for ad-hoc entries", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    geocodeSearch.mockResolvedValue([{ label: "500 Pine St", latitude: 47.63, longitude: -122.35, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText("Home");

    // Add an ad-hoc address via the compare input (type, search, pick the result).
    fireEvent.change(await screen.findByLabelText("Add an address to compare"), { target: { value: "500 Pine" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(await screen.findByText("500 Pine St"));

    // The last canvas capture carries a synthetic ad-hoc place keyed by its coordinate key,
    // and that id is present in selectedIds so it renders as a lettered "selected" pin.
    await waitFor(() => {
      const last = canvasCaptures[canvasCaptures.length - 1]!;
      const synthetic = (last.places as { id: string; inferred_place_type: string }[]).find((p) => p.inferred_place_type === "adhoc_entry");
      expect(synthetic).toBeDefined();
      expect(last.selectedIds.has(synthetic!.id)).toBe(true);
    });
  });

  it("clicking an ad-hoc pin flies to it instead of removing the entry", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    geocodeSearch.mockResolvedValue([{ label: "500 Pine St", latitude: 47.63, longitude: -122.35, source: "test" }]);

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.change(await screen.findByLabelText("Add an address to compare"), { target: { value: "500 Pine" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(await screen.findByText("500 Pine St"));

    // The synthetic's marker uses the entry's coordinate key as its id.
    const adhocId = keyOf({ latitude: 47.63, longitude: -122.35 });
    fireEvent.click(await screen.findByTestId(`marker-${adhocId}`));

    // Focus, not destroy: the entry stays listed (the row's labeled ✕ owns removal) and
    // the map flies to the entry's coordinates.
    const rows = screen.getByRole("list", { name: /addresses to compare/i });
    expect(within(rows).getByText("500 Pine St")).toBeInTheDocument();
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

    // Exit restores the persisted saved selection ([home]) and re-runs it.
    await waitFor(() => {
      const list = screen.getByRole("list", { name: /addresses to compare/i });
      expect(within(list).getByText(home.display_label)).toBeInTheDocument();
    });
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

    expect(screen.getByText("Downtown test point")).toBeInTheDocument();
    expect(screen.getByText("North test point")).toBeInTheDocument();
    expect(screen.queryByText(/shared view/i)).not.toBeInTheDocument();
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
    await backToTabby();

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
    // The restored two-place selection auto-runs and renders the ranked spine.
    expect(await screen.findByTestId("compare-ranked")).toBeInTheDocument();
    await backToTabby();

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "clear" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The clear result empties the panes (invalidate) and the address list. select_places
    // does not switch views, so open the legacy Compare panel to inspect the emptied state.
    openLegacyView("Compare");
    await waitFor(() => expect(screen.queryByTestId("compare-ranked")).not.toBeInTheDocument());
    expect(screen.queryByRole("list", { name: /addresses to compare/i })).not.toBeInTheDocument();
    expect(screen.getByText(/add at least one address/i)).toBeInTheDocument();
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
    // The restored two-place selection auto-runs and renders the ranked spine.
    expect(await screen.findByTestId("compare-ranked")).toBeInTheDocument();
    await backToTabby();

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "just Work" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // A payload-free selection replace is an edit: the stale ranked spine drops and the
    // list swaps to the replacement row, waiting for the next Run. select_places does not
    // switch views, so open the legacy Compare panel to inspect it.
    openLegacyView("Compare");
    await waitFor(() => expect(screen.queryByTestId("compare-ranked")).not.toBeInTheDocument());
    const rows = screen.getByRole("list", { name: /addresses to compare/i });
    expect(within(rows).getByText("Work")).toBeInTheDocument();
    expect(within(rows).queryByText("Home")).not.toBeInTheDocument();
  });

  it("invalidates results when a queued place id resolves under fresh results", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home, work]));
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Home", "Work"));
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 2 });
    vi.mocked(createPlace).mockResolvedValue(pin9);

    render(<MapWorkspace />);
    // The restored two-place selection auto-runs and renders the ranked spine.
    expect(await screen.findByTestId("compare-ranked")).toBeInTheDocument();

    // Pin-save "Pin 9": createPlace resolves, but HOLD the save's summary refresh open so
    // p9 stays queued as pending (it isn't in data.places until that refresh lands).
    let resolveSummary!: (value: DashboardSummary) => void;
    vi.mocked(getDashboardSummary).mockReturnValueOnce(new Promise<DashboardSummary>((resolve) => { resolveSummary = resolve; }));
    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Pin 9" } });
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));
    // Queue-time invalidate drops the greet spine while p9 waits on the held refresh.
    await waitFor(() => expect(screen.queryByTestId("compare-ranked")).not.toBeInTheDocument());

    // A fresh run completes while p9 is still pending.
    fireEvent.click(screen.getByRole("button", { name: /compare 2 addresses/i }));
    expect(await screen.findByTestId("compare-ranked")).toBeInTheDocument();

    // The held refresh now lands WITH p9's place: the resolve-append changes the list
    // under the fresh results, so it must invalidate the now-stale spine.
    resolveSummary(makeSummary([home, work, pin9]));
    await waitFor(() => expect(screen.queryByTestId("compare-ranked")).not.toBeInTheDocument());
    // The chip strip renders the same label once the summary lands, so scope to the address rows.
    const rows = screen.getByRole("list", { name: /addresses to compare/i });
    expect(await within(rows).findByText("Pin 9")).toBeInTheDocument();
  });

  it("keeps an assistant-applied comparison when its refetch resolves a queued place id", async () => {
    // compare-by-name: the backend creates the unsaved place and returns its id, so the
    // bridge's replace queues an id that data.places can't resolve yet. The tool effect's
    // own summary refetch delivers it — and that resolve-append must NOT drop the applied
    // pane (runPoints === null: assistant results aren't keyed to this list).
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
    await screen.findByRole("checkbox", { name: "Home" });
    await backToTabby();
    // Let the greet run's own summary refresh land first, so the deferred below is
    // consumed by the tool effect's refetch and nothing else.
    await waitFor(() => expect(getDashboardSummary).toHaveBeenCalledTimes(2));
    let resolveSummary!: (value: DashboardSummary) => void;
    vi.mocked(getDashboardSummary).mockReturnValueOnce(new Promise<DashboardSummary>((resolve) => { resolveSummary = resolve; }));

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "compare with Pike Street" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The applied pane renders while p9 is still pending resolution.
    expect(await screen.findByTestId("compare-ranked")).toBeInTheDocument();

    // The refetch lands WITH p9's place: the row appends and the pane survives.
    resolveSummary(makeSummary([home, work, pike]));
    const rows = screen.getByRole("list", { name: /addresses to compare/i });
    expect(await within(rows).findByText("Pike Street")).toBeInTheDocument();
    expect(screen.getByTestId("compare-ranked")).toBeInTheDocument();
  });

  it("runs the compare chip as a structured command and applies its effect on the rail", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    // The command stream returns an update_filters tool event regardless of the sent
    // command — pinning both the outgoing payload and the effect→receipt round-trip.
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "tool", data: { tool_name: "update_filters", arguments: {}, result: { patch: { radius_m: 500 } } } });
      onEvent({ event: "token", data: { delta: "Updated the filters: radius 500 m." } });
      onEvent({ event: "done", data: {} });
    });

    render(<MapWorkspace />);
    await screen.findByText("Home");
    await backToTabby();

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

    // The update_filters effect lands as a receipt without leaving the rail (no tab effect),
    // so the composer is still present.
    expect(await screen.findByText("Search radius → 500 m")).toBeInTheDocument();
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
    await backToTabby();

    // Command chips are live before any turn (offline is false).
    expect(screen.getByRole("button", { name: "Compare my places" })).toBeEnabled();

    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "what's the safest block" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The llm_unreachable code flows client → hook → panel: the composer degrades to a
    // disabled textarea + Send behind the offline hint.
    expect(await screen.findByText("Couldn't reach the analyst.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Analyst message")).toBeDisabled());
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    expect(screen.getByText(/your filters and retry still work/i)).toBeInTheDocument();

    // Filters are not gated by offline: a radius change still records a receipt on the rail.
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(await screen.findByText("Search radius → 500 m")).toBeInTheDocument();
  });
});

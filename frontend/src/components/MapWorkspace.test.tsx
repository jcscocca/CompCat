// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Captures each distinct flyTo reference MapCanvas receives — the real MapCanvas re-flies
// on reference change, so the capture list mirrors the fly sequence the map would perform.
const flyToCaptures = vi.hoisted(() => [] as ({ lat: number; lng: number } | null)[]);
vi.mock("./MapCanvas", () => ({
  MapCanvas: ({ places, draft, flyTo, onMapClick, onMarkerClick }: any) => {
    if (flyToCaptures[flyToCaptures.length - 1] !== flyTo) flyToCaptures.push(flyTo);
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
}));

const geocodeSearch = vi.hoisted(() => vi.fn());
vi.mock("../lib/geocoding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/geocoding")>()),
  geocodingProvider: { search: geocodeSearch },
}));

import { MapWorkspace } from "./MapWorkspace";
import { analyzePlaces, comparePlaces, createBulkPlaces, createPlace, createSession, getDashboardSummary, getIncidentDetails, getMcppPolygons, getNeighborhoodAnalysis, streamAssistantChat } from "../api/client";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import { encodeView } from "../lib/savedView";
import type { DashboardSummary, IncidentDetailsResponse, NeighborhoodAnalysis, Place, SiteComparison } from "../types";

const home: Place = {
  id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};
const work: Place = {
  id: "p2", display_label: "Work", latitude: 47.62, longitude: -122.34, visit_count: 3,
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
  // doesn't inherit prior-test state.
  localStorage.removeItem("wp-theme");
  document.documentElement.removeAttribute("data-theme");
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.removeItem("wp-theme");
  document.documentElement.removeAttribute("data-theme");
});

describe("MapWorkspace", () => {
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
      .mockResolvedValueOnce(makeSummary([home]));
    vi.mocked(createPlace).mockResolvedValue(home);
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });

    render(<MapWorkspace />);
    await screen.findByRole("heading", { name: /look up an address/i });

    fireEvent.click(screen.getByRole("button", { name: "Drop a pin on the map" }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.change(screen.getByLabelText(/label/i), { target: { value: "Home" } });
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));

    // Scoped inside the Analyze panel: the chip strip must render WITHIN the absolutely
    // positioned .mc-panel (as its topSlot), not as a covered sibling behind it.
    await waitFor(() => {
      const analyzePanel = screen.getByRole("tabpanel", { name: "Analyze" });
      expect(within(analyzePanel).getByRole("checkbox", { name: "Home" })).toHaveAttribute("aria-checked", "true");
    });

    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

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
      .mockResolvedValueOnce(makeSummary([home, work]));
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

    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

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
    const analyzePanel = screen.getByRole("tabpanel", { name: "Analyze" });
    expect(within(analyzePanel).getByRole("button", { name: /save pin/i })).toBeInTheDocument();
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
      localStorage.setItem("waypoint.drawer.width", "900");
      const focus = render(<MapWorkspace />);
      await screen.findByRole("heading", { name: /look up an address/i });
      expect(focus.container.querySelector(".mc-frame")).toHaveClass("is-focus");
    } finally {
      localStorage.removeItem("waypoint.drawer.width");
      localStorage.removeItem("waypoint.drawer.collapsed");
    }
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

    fireEvent.click(screen.getByRole("checkbox", { name: "Home" }));
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

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

    fireEvent.click(screen.getByRole("checkbox", { name: "Home" }));
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => {
      expect(getIncidentDetails).toHaveBeenCalledWith({
        place_ids: ["p1"],
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

    fireEvent.click(screen.getByRole("checkbox", { name: "Home" }));
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => {
      expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(
        expect.objectContaining({ place_ids: ["p1"], radii_m: [250] }),
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

    fireEvent.click(screen.getByRole("checkbox", { name: "Home" }));
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    expect(await screen.findByText("100 block of Main St")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "500 m" }));

    expect(screen.queryByText("100 BLOCK MAIN ST")).not.toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText("Analyst message"), {
      target: { value: "compare Alpha and Bravo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Only resolves if the bridge replaced the selection (so CompareTab has 2 places),
    // set the comparison, and switched to the Compare tab.
    expect(await screen.findByTestId("compare-ranked")).toBeInTheDocument();
  });

  it("opens the Analyze tab with incidents when the assistant returns analyze_places", async () => {
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
    expect(await screen.findByText("100 block of Main St")).toBeInTheDocument();
  });

  it("hydrates a shared view from ?view= and runs the points path", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });
    vi.mocked(getIncidentDetails).mockResolvedValue(makeIncidentDetails());
    vi.mocked(getNeighborhoodAnalysis).mockResolvedValue(makeNeighborhoodAnalysis());

    const view = encodeView({
      tab: "analyze",
      points: [{ latitude: 47.61, longitude: -122.34, label: "Pike Place" }],
      radiusM: 250, startDate: "2024-01-01", endDate: "2024-01-31",
      layer: "reported", offenseCategory: "",
    });
    window.history.replaceState({}, "", `/?view=${view}`);
    render(<MapWorkspace />);
    expect(await screen.findByText(/shared view/i)).toBeInTheDocument();
    await waitFor(() => expect(getNeighborhoodAnalysis).toHaveBeenCalledWith(
      expect.objectContaining({ points: expect.any(Array) })));
    window.history.replaceState({}, "", "/");
  });

  it("hydrates a shared Compare view and renders its comparison instead of the select-two prompt", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary());
    vi.mocked(comparePlaces).mockResolvedValue(makeSiteComparison("Pike Place", "Second Site"));

    const view = encodeView({
      tab: "compare",
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
    window.history.replaceState({}, "", "/");
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
    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledWith(expect.objectContaining({
        points: [{ latitude: 47.61, longitude: -122.34, label: "123 Main St" }],
        radii_m: [250],
        layer: "reported",
      }));
    });
    expect(createPlace).not.toHaveBeenCalled();
    expect(await screen.findByText("100 block of Main St")).toBeInTheDocument();
  });

  it("re-runs a looked-up address's analysis when the layer changes", async () => {
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

    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledWith(expect.objectContaining({ layer: "reported" }));
    });

    // Flipping the layer must re-run the same looked-up points, not strand the pane blank.
    fireEvent.click(screen.getByRole("button", { name: "911 calls" }));
    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledWith(expect.objectContaining({
        points: [{ latitude: 47.61, longitude: -122.34, label: "123 Main St" }],
        layer: "calls",
      }));
    });
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

    fireEvent.click(await screen.findByRole("button", { name: /compare with another address/i }));

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
    fireEvent.click(await screen.findByRole("button", { name: /save to my places/i }));

    await waitFor(() => {
      expect(createPlace).toHaveBeenCalledWith({
        display_label: "123 Main St",
        latitude: 47.61,
        longitude: -122.34,
        visit_count: 1,
        sensitivity_class: "normal",
      });
    });
    // Saving selects the new place directly (not via the invalidating path), so the verdict
    // computed for the same coordinates stays on screen — a revert to selectPlaceIds would
    // clear this and fail the assertion.
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
    fireEvent.change(screen.getByLabelText("Analyst message"), { target: { value: "analyze Alpha" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.queryByTestId("draft-pin")).not.toBeInTheDocument());
  });
});

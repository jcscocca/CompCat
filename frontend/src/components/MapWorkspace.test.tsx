// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./MapCanvas", () => ({
  MapCanvas: ({ places, onMapClick, onMarkerClick }: any) => (
    <div data-testid="mapcanvas">
      <button data-testid="fire-map-click" onClick={() => onMapClick({ lat: 47.6, lng: -122.3 })} />
      {places.map((place: any) => (
        <button key={place.id} data-testid={`marker-${place.id}`} onClick={() => onMarkerClick(place.id)} />
      ))}
    </div>
  ),
}));

vi.mock("../api/client", () => ({
  analyzePlaces: vi.fn(),
  comparePlaces: vi.fn(),
  createBulkPlaces: vi.fn(),
  createPlace: vi.fn(),
  createSession: vi.fn(),
  deletePlace: vi.fn(),
  getDashboardSummary: vi.fn(),
}));

import { MapWorkspace } from "./MapWorkspace";
import { analyzePlaces, createPlace, createSession, getDashboardSummary } from "../api/client";
import { currentYearAnalysisWindow } from "../lib/analysisDefaults";
import type { DashboardSummary, Place } from "../types";

const home: Place = {
  id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5,
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

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("MapWorkspace", () => {
  it("starts a session and lists returned places", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));

    render(<MapWorkspace />);

    expect(await screen.findByText("Home")).toBeInTheDocument();
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Mobility Context")).toBeInTheDocument();
  });

  it("drops a pin from a map click and saves it", async () => {
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary)
      .mockResolvedValueOnce(makeSummary())
      .mockResolvedValueOnce(makeSummary([home]));
    vi.mocked(createPlace).mockResolvedValue(home);

    render(<MapWorkspace />);
    await screen.findByText(/Map your places/i);

    fireEvent.click(screen.getByRole("button", { name: /add pin/i }));
    fireEvent.click(screen.getByTestId("fire-map-click"));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Home" } });
    fireEvent.click(screen.getByRole("button", { name: /save pin/i }));

    await waitFor(() => {
      expect(createPlace).toHaveBeenCalledWith({
        display_label: "Home",
        latitude: 47.6,
        longitude: -122.3,
        visit_count: 1,
        sensitivity_class: "normal",
      });
    });
  });

  it("runs analysis for a selected place", async () => {
    const window = currentYearAnalysisWindow();
    vi.mocked(createSession).mockResolvedValue({ session_state: "ready" });
    vi.mocked(getDashboardSummary).mockResolvedValue(makeSummary([home]));
    vi.mocked(analyzePlaces).mockResolvedValue({ summary_count: 1 });

    render(<MapWorkspace />);
    await screen.findByText("Home");

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Home" }));
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));

    await waitFor(() => {
      expect(analyzePlaces).toHaveBeenCalledWith({
        place_ids: ["p1"],
        analysis_start_date: window.analysis_start_date,
        analysis_end_date: window.analysis_end_date,
        radii_m: [250],
        offense_category: "PROPERTY",
      });
    });
  });

  it("shows an error when the session cannot start", async () => {
    vi.mocked(createSession).mockRejectedValue(new Error("no session"));
    render(<MapWorkspace />);
    expect(await screen.findByText(/unable to start a dashboard session/i)).toBeInTheDocument();
  });
});

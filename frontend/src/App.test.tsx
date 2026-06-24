// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./components/MapCanvas", () => ({
  MapCanvas: () => <div data-testid="mapcanvas" />,
}));

vi.mock("./api/client", () => ({
  analyzePlaces: vi.fn(),
  comparePlaces: vi.fn(),
  createBulkPlaces: vi.fn(),
  createPlace: vi.fn(),
  createSession: vi.fn().mockResolvedValue({ session_state: "ready" }),
  deletePlace: vi.fn(),
  getDashboardSummary: vi.fn().mockResolvedValue({
    totals: { place_count: 0, visit_count: 0, incident_count: 0 },
    privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
    places: [],
    crime_summaries: [],
    analysis: { available_radii_m: [250] },
    exports: { tableau_place_summary_csv: "/x.csv" },
  }),
}));

import App from "./App";

afterEach(cleanup);

describe("App", () => {
  it("renders the map-first workspace shell", async () => {
    render(<App />);
    expect(await screen.findByText("Mobility Context")).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(4);
  });
});

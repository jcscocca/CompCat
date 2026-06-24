// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PlacesTab } from "./PlacesTab";
import type { DashboardSummary, Place } from "../types";

const home: Place = {
  id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};

const summary: DashboardSummary = {
  totals: { place_count: 1, visit_count: 5, incident_count: 9 },
  privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 0 },
  places: [home],
  crime_summaries: [
    { place_cluster_id: "p1", radius_m: 250, analysis_start_date: "2026-01-01", analysis_end_date: "2026-06-24",
      offense_category: null, offense_subcategory: null, nibrs_group: null, incident_count: 9,
      nearest_incident_m: null, incidents_per_visit: null, incidents_per_hour_dwell: null },
  ],
  analysis: { available_radii_m: [250] },
  exports: { tableau_place_summary_csv: "/x.csv" },
};

function renderTab(overrides: Partial<ComponentProps<typeof PlacesTab>> = {}) {
  const props = {
    places: [home],
    selectedIds: new Set<string>(),
    summary,
    radiusM: 250,
    addPinMode: false,
    draftPopover: null,
    search: <div data-testid="search-slot" />,
    onStartAddPin: vi.fn(),
    onToggleSelect: vi.fn(),
    onDelete: vi.fn(),
    onManualSubmit: vi.fn().mockResolvedValue(undefined),
    onImportSubmit: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<PlacesTab {...props} />);
  return props;
}

afterEach(cleanup);

describe("PlacesTab", () => {
  it("lists saved places with an analyzed count badge", () => {
    renderTab();
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("9 inc.")).toBeInTheDocument();
  });

  it("toggles selection and deletion through callbacks", () => {
    const props = renderTab();
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Home" }));
    expect(props.onToggleSelect).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: "Remove Home" }));
    expect(props.onDelete).toHaveBeenCalledWith("p1");
  });

  it("opens the manual-entry modal", () => {
    renderTab();
    fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Label")).toBeInTheDocument();
  });
});

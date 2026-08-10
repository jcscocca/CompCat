// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { incidentNoun } from "../lib/layerCopy";
import type { AreaSelectionSummary } from "../types";
import { AreaSelectionCard } from "./AreaSelectionCard";

afterEach(cleanup);

const summary: AreaSelectionSummary = {
  selection_id: "selection-1",
  record_count: 3,
  location_count: 2,
  counting_basis: "records with mappable coordinates inside the selected area",
  type_mix: [{ label: "THEFT", count: 3, share: 1 }],
  temporal: {
    hour_counts: Array.from({ length: 24 }, (_, hour) => hour === 12 ? 3 : 0),
    dow_counts: [0, 3, 0, 0, 0, 0, 0],
    hour_by_dow: Array.from({ length: 7 }, () => Array(24).fill(0)),
    total_with_time: 3,
    without_time: 0,
  },
  highlight_mode: "locations",
  highlight_points: [],
  highlight_location_count: 2,
};

function card(over: Partial<Parameters<typeof AreaSelectionCard>[0]> = {}) {
  return <AreaSelectionCard summary={summary} baseSummary={summary} summaryLoading={false} records={{ selection_id: "selection-1", returned_count: 1, page_size: 50, next_cursor: "next", records: [{ incident_id: "i1", external_incident_id: null, report_number: "R1", occurred_at: "2025-01-01T12:00:00-08:00", reported_at: null, offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: null, block_address: "1XX BLOCK OF PINE ST", latitude: 47.61, longitude: -122.33, source_dataset: "seattle_spd_crime" }] }} recordsLoading={false} error={null} noun={incidentNoun("reported")} pageSize={50} pageNumber={1} canPrevious={false} canNext filters={{ selectedTypes: [], selectedHours: [], selectedDays: [] }} onPageSize={vi.fn()} onPrevious={vi.fn()} onNext={vi.fn()} onToggleType={vi.fn()} onToggleHour={vi.fn()} onToggleDay={vi.fn()} onClearFilters={vi.fn()} onRedraw={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} onExport={vi.fn().mockResolvedValue(undefined)} {...over} />;
}

describe("AreaSelectionCard", () => {
  it("shows complete summary charts with accessible exact-value tables", () => {
    render(card());
    expect(screen.getByRole("heading", { name: "Area data" })).toBeInTheDocument();
    expect(screen.getByText(/reported incidents across 2 mapped block locations/i)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /records by hour of day/i })).toBeInTheDocument();
    expect(screen.getAllByText("View exact values")).toHaveLength(2);
  });

  it("turns type, hour, and day bars into linked filter controls", () => {
    const onToggleType = vi.fn();
    const onToggleHour = vi.fn();
    const onToggleDay = vi.fn();
    render(card({ onToggleType, onToggleHour, onToggleDay }));

    fireEvent.click(screen.getByRole("button", { name: "Theft: 3" }));
    fireEvent.click(screen.getByRole("button", { name: "12:00: 3" }));
    fireEvent.click(screen.getByRole("button", { name: "Tuesday: 3" }));

    expect(onToggleType).toHaveBeenCalledWith("THEFT");
    expect(onToggleHour).toHaveBeenCalledWith(12);
    expect(onToggleDay).toHaveBeenCalledWith(1);
  });

  it("shows removable filter chips and matching-of-area context", () => {
    const onToggleType = vi.fn();
    const onClearFilters = vi.fn();
    render(card({
      summary: { ...summary, record_count: 1, location_count: 1 },
      filters: { selectedTypes: ["THEFT"], selectedHours: [], selectedDays: [] },
      onToggleType,
      onClearFilters,
    }));

    expect(screen.getByText(/matching filters \(3 total in area\)/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove Theft filter" }));
    expect(onToggleType).toHaveBeenCalledWith("THEFT");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("switches to paginated underlying data and requests the complete export", async () => {
    const onNext = vi.fn();
    const onExport = vi.fn().mockResolvedValue(undefined);
    render(card({ onNext, onExport }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("table")).toHaveTextContent("100 block of Pine St");
    screen.getByRole("button", { name: "Next" }).click();
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

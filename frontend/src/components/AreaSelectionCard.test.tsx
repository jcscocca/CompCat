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
  type_counts: { THEFT: 3 },
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
  return <AreaSelectionCard summary={summary} baseSummary={summary} summaryLoading={false} records={{ selection_id: "selection-1", returned_count: 1, page_size: 50, next_cursor: "next", records: [{ incident_id: "i1", external_incident_id: null, report_number: "R1", occurred_at: "2025-01-01T12:00:00-08:00", reported_at: null, offense_category: "PROPERTY", offense_subcategory: "THEFT", nibrs_group: null, block_address: "1XX BLOCK OF PINE ST", latitude: 47.61, longitude: -122.33, source_dataset: "seattle_spd_crime" }] }} recordsLoading={false} error={null} noun={incidentNoun("reported")} analysisStartDate="2025-01-01" analysisEndDate="2025-10-27" pageSize={50} pageNumber={1} canPrevious={false} canNext filters={{ selectedTypes: [], selectedHours: [], selectedDays: [] }} onPageSize={vi.fn()} onPrevious={vi.fn()} onNext={vi.fn()} onToggleType={vi.fn()} onToggleHour={vi.fn()} onToggleDay={vi.fn()} onClearFilters={vi.fn()} onRedraw={vi.fn()} onClear={vi.fn()} onClose={vi.fn()} onExport={vi.fn().mockResolvedValue(undefined)} {...over} />;
}

describe("AreaSelectionCard", () => {
  it("shows complete summary charts with accessible exact-value tables", () => {
    render(card());
    expect(screen.getByRole("heading", { name: "Area data" })).toBeInTheDocument();
    expect(screen.getByText("Jan 1, 2025 — Oct 27, 2025")).toBeInTheDocument();
    expect(screen.getByText(/reported incidents across 2 mapped block locations/i)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /records by hour of day/i })).toBeInTheDocument();
    expect(screen.getByText("Scroll for all 24 hours →")).toBeInTheDocument();
    expect(screen.getAllByText("View exact values")).toHaveLength(2);
  });

  it("keeps the active report window visible when the date filter changes", () => {
    const { rerender } = render(card({ analysisStartDate: "2025-07-29" }));
    expect(screen.getByText("Jul 29, 2025 — Oct 27, 2025")).toBeInTheDocument();

    rerender(card({ analysisStartDate: "2025-01-01" }));
    expect(screen.getByText("Jan 1, 2025 — Oct 27, 2025")).toBeInTheDocument();
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

  it("renders every summary metric from the filtered response while preserving filter options", () => {
    const hourCounts = Array(24).fill(0);
    hourCounts[12] = 1;
    const filtered: AreaSelectionSummary = {
      ...summary,
      selection_id: "selection-filtered",
      record_count: 1,
      location_count: 1,
      type_mix: [{ label: "THEFT", count: 1, share: 1 }],
      type_counts: { THEFT: 1 },
      temporal: {
        ...summary.temporal,
        hour_counts: hourCounts,
        dow_counts: [0, 1, 0, 0, 0, 0, 0],
        total_with_time: 1,
        without_time: 0,
      },
    };

    render(card({
      summary: filtered,
      filters: { selectedTypes: ["THEFT"], selectedHours: [12], selectedDays: [1] },
    }));

    expect(screen.getByText(/matching filters \(3 total in area\)/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Theft: 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "12:00: 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "00:00: 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tuesday: 1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Monday: 0" })).toBeInTheDocument();
  });

  it("keeps zero-count buckets available when active filters have no matches", () => {
    render(card({
      summary: {
        ...summary,
        record_count: 0,
        location_count: 0,
        type_mix: [],
        type_counts: {},
        temporal: {
          ...summary.temporal,
          hour_counts: Array(24).fill(0),
          dow_counts: Array(7).fill(0),
          total_with_time: 0,
          without_time: 0,
        },
      },
      filters: { selectedTypes: ["THEFT"], selectedHours: [], selectedDays: [] },
    }));

    expect(screen.getByRole("status")).toHaveTextContent("No records match the active filters");
    expect(screen.getByRole("button", { name: "Theft: 0" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "12:00: 0" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tuesday: 0" })).toBeInTheDocument();
  });

  it("forwards redraw, clear, close, page-size, and previous actions", () => {
    const onRedraw = vi.fn();
    const onClear = vi.fn();
    const onClose = vi.fn();
    const onPageSize = vi.fn();
    const onPrevious = vi.fn();
    render(card({ onRedraw, onClear, onClose, onPageSize, onPrevious, canPrevious: true }));

    fireEvent.click(screen.getByText("Redraw"));
    fireEvent.click(screen.getByRole("button", { name: "Rectangle" }));
    fireEvent.click(screen.getByRole("button", { name: "Polygon" }));
    fireEvent.click(screen.getByRole("button", { name: "Lasso" }));
    expect(onRedraw.mock.calls.map(([mode]) => mode)).toEqual(["rectangle", "polygon", "lasso"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    fireEvent.click(screen.getByRole("button", { name: "Close area data" }));
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Rows" }), { target: { value: "25" } });
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(onPageSize).toHaveBeenCalledWith(25);
    expect(onPrevious).toHaveBeenCalledTimes(1);
  });

  it("switches to paginated underlying data and requests the complete export", async () => {
    const onNext = vi.fn();
    const onExport = vi.fn().mockResolvedValue(undefined);
    render(card({ onNext, onExport }));
    fireEvent.click(screen.getByRole("tab", { name: "Data" }));
    expect(screen.getByRole("table")).toHaveTextContent("100 block of Pine St");
    expect(screen.getByRole("region", { name: /area records table/i })).toHaveAttribute("tabindex", "0");
    screen.getByRole("button", { name: "Next" }).click();
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Export CSV" }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});

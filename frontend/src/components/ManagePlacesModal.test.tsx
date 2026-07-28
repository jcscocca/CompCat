// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ManagePlacesModal } from "./ManagePlacesModal";
import type { DashboardSummary, Place } from "../types";

afterEach(cleanup);
afterEach(() => vi.clearAllMocks());

function place(id: string, label: string, sensitivityClass = "normal"): Place {
  return {
    id,
    display_label: label,
    latitude: 47.6,
    longitude: -122.3,
    visit_count: 1,
    total_dwell_minutes: null,
    inferred_place_type: "manual",
    sensitivity_class: sensitivityClass,
  } as Place;
}

const baseProps = {
  places: [place("p1", "Home"), place("p2", "Work")],
  selectedIds: new Set(["p1"]),
  summary: null,
  radiusM: 400,
  addPinMode: false,
  search: <div data-testid="search-slot" />,
  onStartAddPin: vi.fn(),
  onToggleSelect: vi.fn(),
  onDelete: vi.fn(),
  onManualSubmit: vi.fn().mockResolvedValue(undefined),
  onImportSubmit: vi.fn().mockResolvedValue(undefined),
  onUploaded: undefined,
  onClose: vi.fn(),
  onRename: vi.fn().mockResolvedValue(undefined),
  onToggleExport: vi.fn(),
  exportHref: "/exports/current.csv",
};

describe("ManagePlacesModal", () => {
  it("opens on the Manage view with the place list, search slot, and privacy note", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    expect(screen.getByRole("dialog", { name: "Manage places" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Home" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("checkbox", { name: "Select Work" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByTestId("search-slot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Work" })).toBeInTheDocument();
  });

  it("switches to the Manual view and submits a place", async () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    fireEvent.click(screen.getByRole("button", { name: "Manual" }));
    expect(screen.getByRole("dialog", { name: "Add a place manually" })).toBeInTheDocument();
  });

  it("opens directly on a non-manage view when asked", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manual" />);
    expect(screen.getByRole("dialog", { name: "Add a place manually" })).toBeInTheDocument();
  });

  it("shows the hidden-places privacy badge when the summary reports suppressed places", () => {
    const summary: DashboardSummary = {
      totals: { place_count: 2, visit_count: 0, incident_count: 0 },
      privacy: { normal: 0, home_candidate: 0, work_candidate: 0, suppressed: 2 },
      places: [],
      crime_summaries: [],
      analysis: { available_radii_m: [400] },
      exports: { tableau_place_summary_csv: "/x.csv" },
    };
    render(<ManagePlacesModal {...baseProps} summary={summary} initialView="manage" />);
    const badge = screen.getByText("2 hidden");
    expect(badge).toHaveAttribute("title", "Hidden from public exports");
  });

  it("delegates delete, toggle, drop-pin, and close", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Work" }));
    expect(baseProps.onToggleSelect).toHaveBeenCalledWith("p2");
    fireEvent.click(screen.getByRole("button", { name: "Remove Home" }));
    expect(baseProps.onDelete).toHaveBeenCalledWith("p1");
    fireEvent.click(screen.getByRole("button", { name: /drop pin/i }));
    expect(baseProps.onStartAddPin).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(baseProps.onClose).toHaveBeenCalled();
  });

  it("closes on a scrim click but not on a click inside the dialog", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    fireEvent.mouseDown(screen.getByRole("heading", { name: "Manage places" }));
    expect(baseProps.onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole("dialog", { name: "Manage places" }));
    expect(baseProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("renames a place inline: pencil, edit, Enter", async () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Home" }));
    const input = screen.getByRole("textbox", { name: "New name for Home" });
    fireEvent.change(input, { target: { value: "Home base" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(baseProps.onRename).toHaveBeenCalledWith("p1", "Home base"));
    expect(screen.queryByRole("textbox", { name: "New name for Home" })).not.toBeInTheDocument();
  });

  it("escape cancels a rename without calling the API", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Home" }));
    const input = screen.getByRole("textbox", { name: "New name for Home" });
    fireEvent.change(input, { target: { value: "whatever" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(baseProps.onRename).not.toHaveBeenCalled();
    expect(screen.getByText("Home")).toBeInTheDocument();
  });

  it("rejects an empty rename", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Home" }));
    const input = screen.getByRole("textbox", { name: "New name for Home" });
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(baseProps.onRename).not.toHaveBeenCalled();
    expect(input).toBeInTheDocument();
  });

  it("toggles include-in-export both directions", () => {
    const onToggleExport = vi.fn();
    render(
      <ManagePlacesModal
        {...baseProps}
        places={[place("p1", "Home", "normal"), place("p2", "Clinic", "suppress_from_public_export")]}
        onToggleExport={onToggleExport}
        initialView="manage"
      />,
    );
    const homeToggle = screen.getByRole("checkbox", { name: "Include Home in export" });
    const clinicToggle = screen.getByRole("checkbox", { name: "Include Clinic in export" });
    expect(homeToggle).toBeChecked();
    expect(clinicToggle).not.toBeChecked();

    fireEvent.click(homeToggle);
    expect(onToggleExport).toHaveBeenCalledWith("p1", false);
    fireEvent.click(clinicToggle);
    expect(onToggleExport).toHaveBeenCalledWith("p2", true);
  });

  it("warns that saved places expire with the session", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    expect(
      screen.getByText("Saved places last for this session (about a day). Keep a result with a share link."),
    ).toBeInTheDocument();
  });

  it("renders the export link with the given href", () => {
    render(<ManagePlacesModal {...baseProps} exportHref="/exports/session.csv" initialView="manage" />);
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute("href", "/exports/session.csv");
  });

  it("labels the export link 'Export CSV' and keeps Tableau as a descriptor", () => {
    render(<ManagePlacesModal {...baseProps} initialView="manage" />);
    const link = screen.getByRole("link", { name: "Export CSV" });
    expect(link).toHaveAttribute("href", "/exports/current.csv");
    expect(screen.queryByRole("link", { name: /Download Tableau CSV/ })).not.toBeInTheDocument();
    expect(screen.getByText("Tableau-ready place summary for the current session.")).toBeInTheDocument();
  });
});

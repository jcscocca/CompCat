// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AnalyzeTab } from "./AnalyzeTab";
import type { AnalysisSettings, Place } from "../types";

const home: Place = {
  id: "p1", display_label: "Home", latitude: 47.61, longitude: -122.33, visit_count: 5,
  total_dwell_minutes: null, inferred_place_type: "manual_place", sensitivity_class: "normal",
};

const analysis: AnalysisSettings = { startDate: "2026-01-01", endDate: "2026-06-24", radiusM: 250, offenseCategory: "PROPERTY" };

afterEach(cleanup);

describe("AnalyzeTab", () => {
  it("emits control changes and runs when a place is selected", () => {
    const onChange = vi.fn();
    const onRun = vi.fn();
    render(<AnalyzeTab selected={[home]} analysis={analysis} availableRadii={[250, 500, 1000]} running={false} onChange={onChange} onRun={onRun} />);

    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-02-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-02-01" });

    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });

    fireEvent.click(screen.getByRole("button", { name: "Person" }));
    expect(onChange).toHaveBeenCalledWith({ offenseCategory: "PERSON" });

    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    expect(onRun).toHaveBeenCalled();
  });

  it("disables run when nothing is selected", () => {
    render(<AnalyzeTab selected={[]} analysis={analysis} availableRadii={[250]} running={false} onChange={vi.fn()} onRun={vi.fn()} />);
    expect(screen.getByRole("button", { name: /run analysis/i })).toBeDisabled();
  });
});

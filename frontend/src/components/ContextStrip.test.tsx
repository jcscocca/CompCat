// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ContextStrip } from "./ContextStrip";
import type { AnalysisSettings } from "../types";

const analysis: AnalysisSettings = {
  startDate: "2026-01-01",
  endDate: "2026-07-19",
  radiusM: 250,
  offenseCategory: "",
  layer: "reported",
};

afterEach(cleanup);

function setup(overrides: Partial<AnalysisSettings> = {}) {
  const onChange = vi.fn();
  const result = render(
    <ContextStrip
      analysis={{ ...analysis, ...overrides }}
      availableRadii={[250, 500, 1000]}
      onChange={onChange}
      layerAvailability={{ reported: true, arrests: true, calls: false }}
      locationControls={<div data-testid="location-controls">Saved location controls</div>}
    />,
  );
  return { ...result, onChange };
}

describe("ContextStrip", () => {
  it("keeps every active filter directly selectable without an Edit disclosure", () => {
    const { container } = setup({ offenseCategory: "PROPERTY", layer: "arrests" });
    const summary = container.querySelector(".mc-ctx-summary");

    expect(summary).toHaveTextContent("Tabby is using");
    expect(summary).toHaveTextContent("tell Tabby what to use");
    expect(summary).toHaveTextContent("Saved location controls");
    expect(screen.getByRole("button", { name: "Date range: 2026-01-01 – 2026-07-19" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Search radius: 250 m" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Arrest category: Property" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Data layer: Arrests" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /edit filters/i })).not.toBeInTheDocument();
  });

  it("opens a compact radius popup, applies a choice immediately, and closes", () => {
    const { onChange } = setup();
    const trigger = screen.getByRole("button", { name: "Search radius: 250 m" });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Search radius" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "250 m" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });
    expect(screen.queryByRole("dialog", { name: "Search radius" })).not.toBeInTheDocument();
  });

  it("accepts a custom 400 m radius and normalizes kilometer input", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Search radius: 250 m" }));
    const input = screen.getByLabelText("Custom radius");

    fireEvent.change(input, { target: { value: "0.4 km" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onChange).toHaveBeenCalledWith({ radiusM: 400 });
    expect(screen.queryByRole("dialog", { name: "Search radius" })).not.toBeInTheDocument();
  });

  it("keeps a custom radius inside the 100 m to 1 km product range", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Search radius: 250 m" }));
    fireEvent.change(screen.getByLabelText("Custom radius"), { target: { value: "1.2 km" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Choose a radius from 100 m to 1 km.")).toHaveClass("is-error");
    expect(screen.getByLabelText("Custom radius")).toHaveAttribute("aria-invalid", "true");
  });

  it("opens only one filter popup at a time", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /date range:/i }));
    expect(screen.getByRole("dialog", { name: "Date range" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Search radius: 250 m" }));
    expect(screen.queryByRole("dialog", { name: "Date range" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Search radius" })).toBeInTheDocument();
  });

  it("patches dates through the anchored date popup", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /date range:/i }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-03-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-03-01" });
    expect(screen.getByRole("dialog", { name: "Date range" })).toBeInTheDocument();
  });

  it("applies rolling and year-to-date date presets", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /date range:/i }));
    fireEvent.click(screen.getByRole("button", { name: "Last 30 days" }));
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-06-20", endDate: "2026-07-19" });
  });

  it("rejects a reversed date range before changing the analysis and explains the error", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /date range:/i }));

    const start = screen.getByLabelText("Start date");
    const end = screen.getByLabelText("End date");
    expect(start).toHaveAttribute("max", analysis.endDate);
    expect(end).toHaveAttribute("min", analysis.startDate);
    fireEvent.change(start, { target: { value: "2026-08-01" } });

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Start date must be on or before end date.");
    expect(start).toHaveAttribute("aria-invalid", "true");
  });

  it("disables actions when given an invalid range from an external source", () => {
    setup({ startDate: "2026-08-01", endDate: "2026-07-19" });
    expect(screen.getByRole("button", { name: "Copy link" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /date range:/i })).toHaveAttribute("aria-invalid", "true");
  });

  it("blocks API-invalid long and far-future windows", () => {
    const { onChange } = setup({ startDate: "2018-01-01", endDate: "2026-08-01" });
    expect(screen.getByRole("alert")).toHaveTextContent("3000 days or fewer");

    fireEvent.click(screen.getByRole("button", { name: /date range:/i }));
    const end = screen.getByLabelText("End date");
    expect(end).toHaveAttribute("max");
    fireEvent.change(end, { target: { value: "9999-12-31" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Dates must fall between");
  });

  it("closes on Escape and restores focus to the active filter", () => {
    setup();
    const trigger = screen.getByRole("button", { name: "Search radius: 250 m" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Search radius" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes when the user points outside the filter card", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Search radius: 250 m" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog", { name: "Search radius" })).not.toBeInTheDocument();
  });

  it("patches the offense category and restores focus to its trigger", () => {
    const { onChange } = setup();
    const trigger = screen.getByRole("button", { name: "Incident category: All reported" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "Person" }));

    expect(onChange).toHaveBeenCalledWith({ offenseCategory: "PERSON" });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole("dialog", { name: "Incident category" })).not.toBeInTheDocument();
  });

  it("keeps the all-categories reset label when a narrower category is active", () => {
    setup({ offenseCategory: "PERSON" });
    fireEvent.click(screen.getByRole("button", { name: "Incident category: Person" }));
    expect(screen.getByRole("button", { name: "All reported" })).toBeInTheDocument();
  });

  it("switches data layers, clears the category, and disables unloaded layers", () => {
    const { onChange } = setup({ offenseCategory: "PERSON" });
    fireEvent.click(screen.getByRole("button", { name: "Data layer: Reported incidents" }));

    expect(screen.getByRole("button", { name: "911 calls — No data loaded" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Arrests" }));
    expect(onChange).toHaveBeenCalledWith({ layer: "arrests", offenseCategory: "" });
  });

  it("leaves report execution to the shared composer and keeps Copy link available", () => {
    setup();
    expect(screen.queryByRole("button", { name: /edit filters/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /run (analysis|report)/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy link" })).toBeDisabled();
  });

  it("highlights filters most recently updated by Tabby", () => {
    render(
      <ContextStrip
        analysis={analysis}
        availableRadii={[250, 500, 1000]}
        onChange={vi.fn()}
        assistantUpdatedFields={["radiusM"]}
      />,
    );
    expect(screen.getByRole("button", { name: "Search radius: 250 m" }).closest(".mc-ctx-filter"))
      .toHaveClass("is-assistant-updated");
  });

  it("copies the share link and discloses exact locations and recomputation", async () => {
    const onCopyLink = vi.fn().mockResolvedValue(true);
    render(<ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onCopyLink={onCopyLink} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onCopyLink).toHaveBeenCalled();
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    const hint = screen.getByText(/includes the exact locations, labels, and filters/i);
    expect(hint).toHaveTextContent(/anyone with the link can see them/i);
    expect(hint).toHaveTextContent(/Results recompute from fresh data/i);
  });

  it("shows copy failure without the success disclosure", async () => {
    const onCopyLink = vi.fn().mockResolvedValue(false);
    render(<ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));

    expect(await screen.findByText("Couldn't copy — try again.")).toBeInTheDocument();
    expect(screen.queryByText(/includes the exact locations, labels, and filters/i)).not.toBeInTheDocument();
  });

  it("keeps the copy status region polite and empty at rest", () => {
    setup();
    const status = screen.getByTestId("copy-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("");
  });

  it("shows layer disclosures whether a popup is closed or open", () => {
    setup({ layer: "arrests" });
    expect(screen.getByRole("note")).toHaveTextContent(/enforcement activity, not reported incidents/);
    fireEvent.click(screen.getByRole("button", { name: "Arrest category: All arrests" }));
    expect(screen.getByRole("note")).toHaveTextContent(/enforcement activity, not reported incidents/);
  });

  it("hides the category filter for 911 calls and shows the calls disclosure", () => {
    setup({ layer: "calls" });
    expect(screen.getByRole("note")).toHaveTextContent(/requests for service, not confirmed incidents/);
    expect(screen.queryByRole("button", { name: /category:/i })).not.toBeInTheDocument();
  });

  it("uses arrest-specific category copy", () => {
    setup({ layer: "arrests" });
    fireEvent.click(screen.getByRole("button", { name: "Arrest category: All arrests" }));
    expect(screen.getByRole("dialog", { name: "Arrest category" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All arrests" })).toHaveAttribute("aria-pressed", "true");
  });

  it("has no layer disclosure for the reported layer", () => {
    setup({ layer: "reported" });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

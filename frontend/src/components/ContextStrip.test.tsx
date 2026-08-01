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
      locationControls={<div data-testid="location-controls">Saved location controls</div>}
    />,
  );
  return { ...result, onChange };
}

describe("ContextStrip", () => {
  // The toggle read "Edit" but was named "Analysis context filters: ..." — a speech-input
  // user saying "click Edit" could not activate it (SC 2.5.3).
  it("leads the accessible name with the button's visible text", () => {
    render(<ContextStrip analysis={analysis} availableRadii={[250, 500]} onChange={vi.fn()} />);
    const toggle = screen.getByRole("button", { name: /edit filters/i });
    expect(toggle).toHaveTextContent("Edit");
    expect(toggle.getAttribute("aria-label")).toMatch(/^Edit filters — /);
    fireEvent.click(toggle);
    const open = screen.getByRole("button", { name: /close filters/i });
    expect(open).toHaveTextContent("Close");
    expect(open.getAttribute("aria-label")).toMatch(/^Close filters — /);
  });

  it("summarizes the active context", () => {
    const { container } = setup({ offenseCategory: "PROPERTY", layer: "arrests" });
    const toggle = screen.getByRole("button", { name: /edit filters/i });
    expect(toggle).toHaveTextContent("Edit");
    const summary = container.querySelector(".mc-ctx-summary");
    expect(summary).toHaveTextContent("Analysis filters");
    expect(summary).toHaveTextContent("Saved location controls");
    expect(summary).toHaveTextContent("2026-01-01 – 2026-07-19");
    expect(summary).toHaveTextContent("250 m");
    expect(summary).toHaveTextContent("Property");
    expect(summary).toHaveTextContent("Arrests");
  });

  it("opens the editor on click and patches the radius", () => {
    const { onChange, container } = setup();
    const toggle = screen.getByRole("button", { name: /edit filters/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveTextContent("Close");
    expect(container.querySelector(".mc-ctx-summary-values")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });
  });

  it("patches dates through the date inputs", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-03-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-03-01" });
  });

  it("patches the offense category", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    fireEvent.click(screen.getByRole("button", { name: "Person" }));
    expect(onChange).toHaveBeenCalledWith({ offenseCategory: "PERSON" });
  });

  it("closes the editor with the Done button", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
  });

  it("Run analysis is disabled when runDisabled and fires onRun when enabled", () => {
    const onRun = vi.fn();
    const { rerender } = render(
      <ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onRun={onRun} runDisabled />,
    );
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    const runButton = screen.getByRole("button", { name: "Run analysis" });
    expect(runButton).toBeDisabled();

    rerender(
      <ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onRun={onRun} runDisabled={false} />,
    );
    expect(screen.getByRole("button", { name: "Run analysis" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Run analysis" }));
    expect(onRun).toHaveBeenCalled();
  });

  it("copies the share link and flashes a transient Copied note", async () => {
    const onCopyLink = vi.fn().mockResolvedValue(true);
    render(<ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(onCopyLink).toHaveBeenCalled();
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("shows a failure note when the copy handler reports failure", async () => {
    const onCopyLink = vi.fn().mockResolvedValue(false);
    render(<ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Couldn't copy — try again.")).toBeInTheDocument();
  });

  it("discloses exact locations and recomputation once a link is copied", async () => {
    const onCopyLink = vi.fn().mockResolvedValue(true);
    render(<ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    expect(screen.queryByText(/includes the exact locations, labels, and filters/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    const hint = await screen.findByText(/includes the exact locations, labels, and filters/i);
    expect(hint).toHaveTextContent(/anyone with the link can see them/i);
    expect(hint).toHaveTextContent(/Results recompute from fresh data/i);
  });

  it("keeps the ephemerality hint off the failure path", async () => {
    const onCopyLink = vi.fn().mockResolvedValue(false);
    render(<ContextStrip analysis={analysis} availableRadii={[250, 500, 1000]} onChange={vi.fn()} onCopyLink={onCopyLink} />);
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByText("Couldn't copy — try again.")).toBeInTheDocument();
    expect(screen.queryByText(/includes the exact locations, labels, and filters/i)).not.toBeInTheDocument();
  });

  it("copy status region is polite live and empty at rest", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    const status = screen.getByTestId("copy-status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent("");
  });

  it("shows the arrests layer disclosure below the summary, editor closed or open", () => {
    setup({ layer: "arrests" });
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/enforcement activity, not reported incidents/);
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    expect(screen.getByRole("note")).toHaveTextContent(/enforcement activity, not reported incidents/);
  });

  it("shows the calls layer disclosure", () => {
    setup({ layer: "calls" });
    expect(screen.getByRole("note")).toHaveTextContent(/requests for service, not confirmed incidents/);
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    expect(screen.queryByRole("group", { name: "Incident categories" })).not.toBeInTheDocument();
    expect(screen.queryByText("All reported")).not.toBeInTheDocument();
  });

  it("uses arrest-specific category copy", () => {
    setup({ layer: "arrests" });
    fireEvent.click(screen.getByRole("button", { name: /edit filters/i }));
    expect(screen.getByRole("group", { name: "Arrest categories" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All arrests" })).toBeInTheDocument();
  });

  it("has no layer disclosure for the reported layer", () => {
    setup({ layer: "reported" });
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
  });
});

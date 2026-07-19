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
  render(
    <ContextStrip
      analysis={{ ...analysis, ...overrides }}
      availableRadii={[250, 500, 1000]}
      onChange={onChange}
    />,
  );
  return { onChange };
}

describe("ContextStrip", () => {
  it("summarizes the active context", () => {
    setup({ offenseCategory: "PROPERTY", layer: "arrests" });
    const toggle = screen.getByRole("button", { name: /analysis context/i });
    expect(toggle).toHaveTextContent("2026-01-01 – 2026-07-19");
    expect(toggle).toHaveTextContent("250 m");
    expect(toggle).toHaveTextContent("Property");
    expect(toggle).toHaveTextContent("Arrests");
  });

  it("opens the editor on click and patches the radius", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "500 m" }));
    expect(onChange).toHaveBeenCalledWith({ radiusM: 500 });
  });

  it("patches dates through the date inputs", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-03-01" } });
    expect(onChange).toHaveBeenCalledWith({ startDate: "2026-03-01" });
  });

  it("patches the offense category", () => {
    const { onChange } = setup();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    fireEvent.click(screen.getByRole("button", { name: "Person" }));
    expect(onChange).toHaveBeenCalledWith({ offenseCategory: "PERSON" });
  });

  it("closes the editor with the Done button", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /analysis context/i }));
    expect(screen.getByLabelText("Start date")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByLabelText("Start date")).not.toBeInTheDocument();
  });
});

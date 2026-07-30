// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LayerToggle } from "./LayerToggle";

afterEach(cleanup);

describe("LayerToggle", () => {
  it("marks the active layer and emits a change on click", () => {
    const onChange = vi.fn();
    render(<LayerToggle layer="reported" onChange={onChange} />);

    expect(screen.getByRole("button", { name: "Reported incidents" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.click(screen.getByRole("button", { name: "911 calls" }));
    expect(onChange).toHaveBeenCalledWith("calls");
  });

  it("offers reported, arrests, and calls", () => {
    render(<LayerToggle layer="reported" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /reported incidents/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^arrests$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /911 calls/i })).toBeInTheDocument();
  });

  // The badge was aria-hidden, so the disabled state had no announced explanation; and the
  // visible "No data" was absent from the accessible name (SC 2.5.3).
  it("announces the no-data state and keeps the visible text inside the accessible name", () => {
    render(
      <LayerToggle layer="reported" onChange={vi.fn()} availability={{ reported: true, arrests: false, calls: true }} />,
    );
    const arrests = screen.getByRole("button", { name: /arrests/i });
    expect(arrests).toHaveAccessibleName("Arrests — No data loaded");
    expect(arrests).toHaveTextContent("No data");
    // Every word visible on the control appears in its accessible name.
    for (const word of ["Arrests", "No data"]) {
      expect(arrests.getAttribute("aria-label")).toContain(word);
    }
    expect(arrests.querySelector(".mc-layer-unavailable")).not.toHaveAttribute("aria-hidden");
  });

  it("disables layers confirmed to have no loaded data", () => {
    render(
      <LayerToggle
        layer="reported"
        onChange={vi.fn()}
        availability={{ reported: true, arrests: false, calls: false }}
      />,
    );
    expect(screen.getByRole("button", { name: /arrests/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /911 calls/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /reported incidents/i })).toBeEnabled();
  });
});

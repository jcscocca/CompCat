// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MapLegend } from "./MapLegend";

afterEach(cleanup);

describe("MapLegend", () => {
  it("documents every marker state", () => {
    const { container } = render(<MapLegend layer="reported" />);
    expect(screen.getByRole("region", { name: "Map key" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Map key", level: 2 })).toBeInTheDocument();
    expect(screen.getByText("Saved place")).toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText(/Analyzed radius/i)).toBeInTheDocument();
    expect(screen.getByText("Low data")).toBeInTheDocument();
    expect(container.querySelectorAll(".mc-leg-dot")).toHaveLength(2);
  });

  // The dots and clusters plot whichever layer is active, so a legend hard-coded to
  // "Reported incident" mislabels the arrests and 911-call layers.
  it.each([
    ["reported" as const, "Reported incident", "reported incident count"],
    ["arrests" as const, "Arrest", "arrest count"],
    ["calls" as const, "911 call", "911 call count"],
  ])("names the %s layer on the dot, grouped-count and radius rows", (layer, singular, radiusNote) => {
    render(<MapLegend layer={layer} />);
    expect(screen.getByText(singular)).toBeInTheDocument();
    const plural = layer === "reported" ? "reported incidents" : layer === "arrests" ? "arrests" : "911 calls";
    expect(screen.getByText(`Grouped ${plural}`)).toBeInTheDocument();
    expect(screen.getByText("larger dot = more records · select for exact count")).toBeInTheDocument();
    expect(screen.getByText(`Same-block ${plural}`)).toBeInTheDocument();
    expect(screen.getByText("select for exact count · large stacks label at close zoom")).toBeInTheDocument();
    expect(screen.getByText(radiusNote)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MapLegend } from "./MapLegend";

afterEach(cleanup);

describe("MapLegend", () => {
  it("documents every marker state", () => {
    render(<MapLegend layer="reported" />);
    expect(screen.getByText("Map key")).toBeInTheDocument();
    expect(screen.getByText("Saved place")).toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText(/Analyzed radius/i)).toBeInTheDocument();
    expect(screen.getByText("Low data")).toBeInTheDocument();
  });

  // The dots and clusters plot whichever layer is active, so a legend hard-coded to
  // "Reported incident" mislabels the arrests and 911-call layers.
  it.each([
    ["reported" as const, "Reported incident", "reported incident count"],
    ["arrests" as const, "Arrest", "arrest count"],
    ["calls" as const, "911 call", "911 call count"],
  ])("names the %s layer on the dot, cluster and radius rows", (layer, singular, radiusNote) => {
    render(<MapLegend layer={layer} />);
    expect(screen.getByText(singular)).toBeInTheDocument();
    expect(screen.getByText(`${singular} cluster`)).toBeInTheDocument();
    expect(screen.getByText(radiusNote)).toBeInTheDocument();
  });
});

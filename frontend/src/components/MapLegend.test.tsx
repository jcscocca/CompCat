// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { MapLegend } from "./MapLegend";

afterEach(cleanup);

describe("MapLegend", () => {
  it("documents every marker state", () => {
    render(<MapLegend />);
    expect(screen.getByText("Map key")).toBeInTheDocument();
    expect(screen.getByText("Saved place")).toBeInTheDocument();
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByText(/Analyzed radius/i)).toBeInTheDocument();
    expect(screen.getByText("Low data")).toBeInTheDocument();
  });
});

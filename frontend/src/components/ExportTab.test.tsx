// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ExportTab } from "./ExportTab";

afterEach(cleanup);

describe("ExportTab", () => {
  it("links to the place-summary CSV and states data limitations", () => {
    render(<ExportTab href="/exports/current.csv" />);
    expect(screen.getByRole("link", { name: /place summary csv/i })).toHaveAttribute("href", "/exports/current.csv");
    expect(screen.getByText(/does not claim safety, risk, or recommended places/i)).toBeInTheDocument();
  });
});

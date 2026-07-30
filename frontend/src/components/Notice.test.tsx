// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Notice } from "./Notice";
import { CAVEAT_DATA_LIMITS, CAVEAT_HEADLINE } from "../lib/layerCopy";

afterEach(cleanup);

describe("Notice", () => {
  // It used to say "not safety advice" while every result surface said "not a personal risk
  // prediction" — two different claims for one invariant.
  it("states the invariant in the same words as the result surfaces", () => {
    render(<Notice />);
    expect(screen.getByText(CAVEAT_HEADLINE)).toBeInTheDocument();
    expect(screen.getByText(CAVEAT_DATA_LIMITS)).toBeInTheDocument();
    expect(screen.getByLabelText("Important data note").textContent).not.toMatch(/safety advice/);
  });
});

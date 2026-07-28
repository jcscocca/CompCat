// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MethodsAppendix } from "./MethodsAppendix";
import { METHODS_DEFINITIONS } from "../lib/methodsDefinitions";

afterEach(cleanup);

describe("MethodsAppendix", () => {
  it("opens from the Methods button and lists every definition", () => {
    render(<MethodsAppendix />);
    fireEvent.click(screen.getByRole("button", { name: /methods/i }));
    for (const def of METHODS_DEFINITIONS) {
      expect(screen.getByText(def.term)).toBeInTheDocument();
    }
  });

  it("defines NIBRS in the appendix", () => {
    render(<MethodsAppendix />);
    fireEvent.click(screen.getByRole("button", { name: /methods/i }));
    expect(screen.getByText("NIBRS group")).toBeInTheDocument();
    expect(screen.getByText(/National Incident-Based Reporting System/)).toBeInTheDocument();
  });

  it("every measure id is unique", () => {
    const ids = METHODS_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

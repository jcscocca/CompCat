// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MethodsAppendix } from "./MethodsAppendix";
import { METHODS_DEFINITIONS } from "../lib/methodsDefinitions";

describe("MethodsAppendix", () => {
  it("opens from the Methods button and lists every definition", () => {
    render(<MethodsAppendix />);
    fireEvent.click(screen.getByRole("button", { name: /methods/i }));
    for (const def of METHODS_DEFINITIONS) {
      expect(screen.getByText(def.term)).toBeInTheDocument();
    }
  });

  it("every measure id is unique", () => {
    const ids = METHODS_DEFINITIONS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RailNav } from "./RailNav";

afterEach(cleanup);

describe("RailNav", () => {
  it("shows no back button on the Tabby view", () => {
    render(<RailNav view="tabby" compareCount={0} onSelect={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /back to tabby/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More panels" })).toBeInTheDocument();
  });

  it("opens the menu and selects Compare with its count", () => {
    const onSelect = vi.fn();
    render(<RailNav view="tabby" compareCount={2} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "More panels" }));
    const compare = screen.getByRole("menuitem", { name: /compare/i });
    expect(compare).toHaveTextContent("2");
    fireEvent.click(compare);
    expect(onSelect).toHaveBeenCalledWith("compare");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("selects Export from the menu", () => {
    const onSelect = vi.fn();
    render(<RailNav view="tabby" compareCount={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "More panels" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Export" }));
    expect(onSelect).toHaveBeenCalledWith("export");
  });

  it("closes the menu on Escape and restores trigger focus", () => {
    render(<RailNav view="tabby" compareCount={0} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "More panels" }));
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More panels" })).toHaveFocus();
  });

  it("returns to Tabby from a legacy view", () => {
    const onSelect = vi.fn();
    render(<RailNav view="compare" compareCount={0} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Back to Tabby" }));
    expect(onSelect).toHaveBeenCalledWith("tabby");
  });
});

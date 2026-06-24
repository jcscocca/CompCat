// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BottomSheet } from "./BottomSheet";

afterEach(cleanup);

describe("BottomSheet", () => {
  it("renders four tabs and marks the active one", () => {
    render(
      <BottomSheet activeTab="places" onTabChange={vi.fn()} sheetState="half" onSheetStateChange={vi.fn()}>
        <div>panel</div>
      </BottomSheet>,
    );
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: /places/i })).toHaveAttribute("aria-selected", "true");
  });

  it("calls onTabChange when another tab is clicked", () => {
    const onTabChange = vi.fn();
    render(
      <BottomSheet activeTab="places" onTabChange={onTabChange} sheetState="half" onSheetStateChange={vi.fn()}>
        <div>panel</div>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    expect(onTabChange).toHaveBeenCalledWith("analyze");
  });

  it("activates tabs and snap controls from the keyboard", () => {
    const onTabChange = vi.fn();
    const onSheetStateChange = vi.fn();
    render(
      <BottomSheet activeTab="places" onTabChange={onTabChange} sheetState="half" onSheetStateChange={onSheetStateChange}>
        <div>panel</div>
      </BottomSheet>,
    );

    fireEvent.keyDown(screen.getByRole("tab", { name: /analyze/i }), { key: "Enter" });
    expect(onTabChange).toHaveBeenCalledWith("analyze");

    fireEvent.keyDown(screen.getByRole("button", { name: /full/i }), { key: " " });
    expect(onSheetStateChange).toHaveBeenCalledWith("full");
  });

  it("exposes snap controls and reflects the state class", () => {
    const onSheetStateChange = vi.fn();
    const { container } = render(
      <BottomSheet activeTab="places" onTabChange={vi.fn()} sheetState="half" onSheetStateChange={onSheetStateChange}>
        <div>panel</div>
      </BottomSheet>,
    );
    expect(container.querySelector(".mc-sheet")).toHaveClass("is-half");
    fireEvent.click(screen.getByRole("button", { name: /full/i }));
    expect(onSheetStateChange).toHaveBeenCalledWith("full");
  });
});

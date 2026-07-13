// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BottomSheet } from "./BottomSheet";
import { clampWidth, DRAWER_DEFAULT, DRAWER_WIDE } from "../lib/drawer";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
}

afterEach(cleanup);

function renderSheet(overrides: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  const props = {
    activeTab: "places" as const,
    onTabChange: vi.fn(),
    collapsed: false,
    widthPx: DRAWER_DEFAULT,
    onToggleCollapsed: vi.fn(),
    onResize: vi.fn(),
    onPreset: vi.fn(),
    ...overrides,
  };
  const result = render(<BottomSheet {...props}><div>panel</div></BottomSheet>);
  return { ...result, props };
}

describe("BottomSheet", () => {
  it("renders four tabs and marks the active one", () => {
    renderSheet({ activeTab: "places" });
    expect(screen.getAllByRole("tab")).toHaveLength(4);
    expect(screen.getByRole("tab", { name: /places/i })).toHaveAttribute("aria-selected", "true");
  });

  it("calls onTabChange when another tab is clicked or activated by keyboard", () => {
    const { props } = renderSheet();
    fireEvent.click(screen.getByRole("tab", { name: /analyze/i }));
    expect(props.onTabChange).toHaveBeenCalledWith("analyze");
    fireEvent.keyDown(screen.getByRole("tab", { name: /compare/i }), { key: "Enter" });
    expect(props.onTabChange).toHaveBeenCalledWith("compare");
  });

  it("exposes Peek, Default, and Wide presets and marks the active one pressed", () => {
    const { props } = renderSheet({ widthPx: DRAWER_DEFAULT });
    expect(screen.getByRole("button", { name: /default/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /peek/i })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: /wide/i }));
    expect(props.onPreset).toHaveBeenCalledWith("wide");
  });

  it("offers a Focus preset and forwards it", () => {
    const onPreset = vi.fn();
    renderSheet({ onPreset });
    fireEvent.click(screen.getByRole("button", { name: "Focus" }));
    expect(onPreset).toHaveBeenCalledWith("focus");
  });

  it("keeps the Wide preset pressed when its width is clamped on a narrow viewport", () => {
    setViewport(680); // drawerMax() == max(340, 680 - 96) == 584, so clampWidth(DRAWER_WIDE=640) == 584
    try {
      renderSheet({ widthPx: clampWidth(DRAWER_WIDE) });
      expect(screen.getByRole("button", { name: /wide/i })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /default/i })).toHaveAttribute("aria-pressed", "false");
    } finally {
      setViewport(1024);
    }
  });

  it("never marks both Default and Wide pressed when their clamped widths collide", () => {
    setViewport(460); // drawerMax() == max(340, 460 - 96) == 364, so clampWidth(DEFAULT) === clampWidth(WIDE) === 364
    try {
      renderSheet({ widthPx: clampWidth(DRAWER_WIDE) });
      // A segmented control must have a single active option; the shared clamped width
      // reads as "default" rather than lighting up both buttons at once.
      expect(screen.getByRole("button", { name: /default/i })).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("button", { name: /wide/i })).toHaveAttribute("aria-pressed", "false");
    } finally {
      setViewport(1024);
    }
  });

  it("marks Peek pressed when collapsed", () => {
    renderSheet({ collapsed: true });
    expect(screen.getByRole("button", { name: /peek/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("exposes the handle as a separator reflecting the current width", () => {
    renderSheet({ widthPx: 512 });
    const handle = screen.getByRole("separator", { name: /resize workspace panel/i });
    expect(handle).toHaveAttribute("aria-valuenow", "512");
  });

  it("resizes with arrow keys (open) by the resize step", () => {
    const { props } = renderSheet({ widthPx: 400 });
    const handle = screen.getByRole("separator", { name: /resize workspace panel/i });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(props.onResize).toHaveBeenCalledWith(424);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(props.onResize).toHaveBeenCalledWith(376);
  });

  it("toggles collapse with Enter and with a click that does not drag", () => {
    const { props } = renderSheet();
    const handle = screen.getByRole("separator", { name: /resize workspace panel/i });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 500 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 500 });
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(2);
  });

  it("resizes from a pointer drag using the panel's right edge", () => {
    const { props, container } = renderSheet({ widthPx: 400 });
    const panel = container.querySelector(".mc-workspace-panel") as HTMLElement;
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({ right: 1000, left: 600, top: 0, bottom: 0, width: 400, height: 0, x: 600, y: 0, toJSON: () => ({}) } as DOMRect);
    const handle = screen.getByRole("separator", { name: /resize workspace panel/i });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 600 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 520 });
    expect(props.onResize).toHaveBeenCalledWith(480);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 520 });
    expect(props.onToggleCollapsed).not.toHaveBeenCalled();
  });

  it("does not resize with arrow keys while collapsed", () => {
    const { props } = renderSheet({ collapsed: true });
    const handle = screen.getByRole("separator", { name: /resize workspace panel/i });
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(props.onResize).not.toHaveBeenCalled();
  });

  it("renders the panel open with an inline width, collapsed without one", () => {
    const { container, rerender } = renderSheet({ collapsed: false, widthPx: 420 });
    const panel = () => container.querySelector(".mc-workspace-panel") as HTMLElement;
    expect(panel()).toHaveClass("is-open");
    expect(panel().style.width).toBe("420px");
    rerender(
      <BottomSheet activeTab="places" onTabChange={vi.fn()} collapsed widthPx={420} onToggleCollapsed={vi.fn()} onResize={vi.fn()} onPreset={vi.fn()}>
        <div>panel</div>
      </BottomSheet>,
    );
    expect(panel()).toHaveClass("is-collapsed");
    expect(panel().style.width).toBe("");
  });
});

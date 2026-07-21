// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BottomSheet } from "./BottomSheet";
import { DRAWER_DEFAULT } from "../lib/drawer";

function setViewportHeight(height: number) {
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true, writable: true });
}

function mockPanelHeight(container: HTMLElement, height: number): HTMLElement {
  const panel = container.querySelector(".mc-workspace-panel") as HTMLElement;
  vi.spyOn(panel, "getBoundingClientRect").mockReturnValue({
    height, width: 375, top: 0, bottom: height, left: 0, right: 375, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect);
  return panel;
}

afterEach(cleanup);

function renderSheet(overrides: Partial<Parameters<typeof BottomSheet>[0]> = {}) {
  const props = {
    collapsed: false,
    widthPx: DRAWER_DEFAULT,
    onToggleCollapsed: vi.fn(),
    onResize: vi.fn(),
    ...overrides,
  };
  const result = render(<BottomSheet {...props}><div>panel</div></BottomSheet>);
  return { ...result, props };
}

describe("BottomSheet", () => {
  it("does not expose named desktop size modes", () => {
    renderSheet();
    expect(screen.queryByRole("button", { name: "Peek" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Default" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Wide" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Focus" })).not.toBeInTheDocument();
  });

  it("renders a Tabby edge tab when collapsed and restores the pane from it", () => {
    const { props } = renderSheet({ collapsed: true });
    const restore = screen.getByRole("button", { name: "Expand Tabby pane" });
    expect(restore).toHaveClass("mc-pane-tab");
    fireEvent.click(restore);
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("separator", { name: /resize workspace panel/i })).not.toBeInTheDocument();
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

  it("renders the panel open with an inline width, collapsed without one", () => {
    const { container, rerender } = renderSheet({ collapsed: false, widthPx: 420 });
    const panel = () => container.querySelector(".mc-workspace-panel") as HTMLElement;
    expect(panel()).toHaveClass("is-open");
    expect(panel().style.width).toBe("420px");
    rerender(
      <BottomSheet collapsed widthPx={420} onToggleCollapsed={vi.fn()} onResize={vi.fn()}>
        <div>panel</div>
      </BottomSheet>,
    );
    expect(panel()).toHaveClass("is-collapsed");
    expect(panel().style.width).toBe("");
  });

  it("mobile: renders a grabber and the peek header instead of the resize handle", () => {
    renderSheet({ isMobile: true, peekHeader: <div>LAYER SLOT</div> });
    expect(screen.getByRole("button", { name: /collapse panel/i })).toBeInTheDocument();
    expect(screen.getByText("LAYER SLOT")).toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: /resize workspace panel/i })).not.toBeInTheDocument();
  });

  it("desktop: keeps the vertical resize handle and no grabber", () => {
    renderSheet({ isMobile: false });
    expect(screen.getByRole("separator", { name: /resize workspace panel/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /(collapse|expand) panel/i })).not.toBeInTheDocument();
  });

  it("mobile: a tap on the grabber toggles collapsed", () => {
    const { props } = renderSheet({ isMobile: true, collapsed: false });
    const grabber = screen.getByRole("button", { name: /collapse panel/i });
    fireEvent.pointerDown(grabber, { clientY: 120, pointerId: 1 });
    fireEvent.pointerUp(grabber, { clientY: 122, pointerId: 1 });
    expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it("mobile: applies only the is-<snap> class, not the desktop collapsed/open class", () => {
    const { container, rerender } = renderSheet({ isMobile: true, collapsed: false, snap: "full" });
    const panel = () => container.querySelector(".mc-workspace-panel") as HTMLElement;
    expect(panel()).toHaveClass("is-full");
    expect(panel()).not.toHaveClass("is-open");
    rerender(
      <BottomSheet collapsed widthPx={DRAWER_DEFAULT} snap="bar" isMobile onToggleCollapsed={vi.fn()} onResize={vi.fn()}>
        <div>panel</div>
      </BottomSheet>,
    );
    expect(panel()).toHaveClass("is-bar");
    expect(panel()).not.toHaveClass("is-collapsed");
  });

  it("mobile: derives the snap class from collapsed when no snap prop is passed", () => {
    const { container } = renderSheet({ isMobile: true, collapsed: true });
    expect(container.querySelector(".mc-workspace-panel")).toHaveClass("is-bar");
  });

  it("mobile: sets --kb-inset from visualViewport and cleans it up on unmount", () => {
    const listeners: Record<string, Set<() => void>> = { resize: new Set(), scroll: new Set() };
    const vv = {
      height: 800,
      offsetTop: 0,
      addEventListener: (type: string, cb: () => void) => listeners[type]?.add(cb),
      removeEventListener: (type: string, cb: () => void) => listeners[type]?.delete(cb),
    };
    Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
    setViewportHeight(1000); // innerHeight - vv.height - offsetTop = 200px of keyboard inset
    try {
      const { container, unmount } = renderSheet({ isMobile: true, collapsed: false, snap: "half", onSnap: vi.fn() });
      const panel = container.querySelector(".mc-workspace-panel") as HTMLElement;
      expect(panel.style.getPropertyValue("--kb-inset")).toBe("200px"); // update() runs on mount
      vv.height = 1000; // keyboard dismissed
      listeners.resize.forEach((cb) => cb());
      expect(panel.style.getPropertyValue("--kb-inset")).toBe("0px");
      unmount();
      expect(listeners.resize.size).toBe(0);
      expect(listeners.scroll.size).toBe(0);
    } finally {
      Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true });
      setViewportHeight(768);
    }
  });

  // Velocity-biased nearest-snap release. Viewport 800 → snap heights bar=120, half=400, full=736.
  describe("mobile grabber snap + velocity release", () => {
    let now = 0;
    beforeEach(() => {
      now = 0;
      setViewportHeight(800);
      vi.spyOn(performance, "now").mockImplementation(() => now);
    });
    afterEach(() => {
      vi.restoreAllMocks();
      setViewportHeight(768);
    });

    it("a slow drag ending near 40% of the viewport snaps to half", () => {
      const onSnap = vi.fn();
      const { container } = renderSheet({ isMobile: true, collapsed: false, snap: "full", onSnap });
      mockPanelHeight(container, 736); // start at full
      const grabber = screen.getByRole("button", { name: /collapse panel/i });
      now = 0;
      fireEvent.pointerDown(grabber, { clientY: 50, pointerId: 1 });
      now = 2000; // dt=2000ms → slow
      fireEvent.pointerUp(grabber, { clientY: 466, pointerId: 1 }); // dy=+416 → endHeight 320 ≈ half
      expect(onSnap).toHaveBeenCalledWith("half");
    });

    it("a slow drag near the top of the viewport snaps to full", () => {
      const onSnap = vi.fn();
      const { container } = renderSheet({ isMobile: true, collapsed: false, snap: "half", onSnap });
      mockPanelHeight(container, 400); // start at half
      const grabber = screen.getByRole("button", { name: /collapse panel/i });
      now = 0;
      fireEvent.pointerDown(grabber, { clientY: 400, pointerId: 1 });
      now = 2000;
      fireEvent.pointerUp(grabber, { clientY: 60, pointerId: 1 }); // dy=-340 → endHeight 740 ≈ full
      expect(onSnap).toHaveBeenCalledWith("full");
    });

    it("a slow small drag settles back on the nearest snap", () => {
      const onSnap = vi.fn();
      const { container } = renderSheet({ isMobile: true, collapsed: false, snap: "half", onSnap });
      mockPanelHeight(container, 400);
      const grabber = screen.getByRole("button", { name: /collapse panel/i });
      now = 0;
      fireEvent.pointerDown(grabber, { clientY: 100, pointerId: 1 });
      now = 2000;
      fireEvent.pointerUp(grabber, { clientY: 130, pointerId: 1 }); // dy=+30 → endHeight 370, nearest half
      expect(onSnap).toHaveBeenCalledWith("half");
    });

    it("a fast downward flick from half lands on bar despite a small displacement", () => {
      const onSnap = vi.fn();
      const { container } = renderSheet({ isMobile: true, collapsed: false, snap: "half", onSnap });
      mockPanelHeight(container, 400);
      const grabber = screen.getByRole("button", { name: /collapse panel/i });
      now = 0;
      fireEvent.pointerDown(grabber, { clientY: 100, pointerId: 1 });
      now = 10; // dt=10ms → velocity 2 px/ms
      fireEvent.pointerUp(grabber, { clientY: 120, pointerId: 1 }); // dy=+20 → endHeight 380 (nearest half) biased down
      expect(onSnap).toHaveBeenCalledWith("bar");
    });

    it("a fast upward flick from half lands on full", () => {
      const onSnap = vi.fn();
      const { container } = renderSheet({ isMobile: true, collapsed: false, snap: "half", onSnap });
      mockPanelHeight(container, 400);
      const grabber = screen.getByRole("button", { name: /collapse panel/i });
      now = 0;
      fireEvent.pointerDown(grabber, { clientY: 100, pointerId: 1 });
      now = 10;
      fireEvent.pointerUp(grabber, { clientY: 80, pointerId: 1 }); // dy=-20 → endHeight 420 (nearest half) biased up
      expect(onSnap).toHaveBeenCalledWith("full");
    });

    it("a tap toggles collapsed and commits no snap", () => {
      const onSnap = vi.fn();
      const { props } = renderSheet({ isMobile: true, collapsed: false, snap: "half", onSnap });
      const grabber = screen.getByRole("button", { name: /collapse panel/i });
      now = 0;
      fireEvent.pointerDown(grabber, { clientY: 120, pointerId: 1 });
      now = 5;
      fireEvent.pointerUp(grabber, { clientY: 123, pointerId: 1 }); // dy=3 ≤ slop → tap
      expect(props.onToggleCollapsed).toHaveBeenCalledTimes(1);
      expect(onSnap).not.toHaveBeenCalled();
    });

    it("captures and releases the pointer across a drag", () => {
      const onSnap = vi.fn();
      const { container } = renderSheet({ isMobile: true, collapsed: false, snap: "half", onSnap });
      mockPanelHeight(container, 400);
      const grabber = screen.getByRole("button", { name: /collapse panel/i });
      grabber.setPointerCapture = vi.fn();
      grabber.releasePointerCapture = vi.fn();
      now = 0;
      fireEvent.pointerDown(grabber, { clientY: 100, pointerId: 7 });
      now = 2000;
      fireEvent.pointerUp(grabber, { clientY: 200, pointerId: 7 });
      expect(grabber.setPointerCapture).toHaveBeenCalledWith(7);
      expect(grabber.releasePointerCapture).toHaveBeenCalledWith(7);
    });

    it("sets a live inline height while dragging and clears it on release", () => {
      const onSnap = vi.fn();
      const { container } = renderSheet({ isMobile: true, collapsed: false, snap: "half", onSnap });
      const panel = mockPanelHeight(container, 400);
      const grabber = screen.getByRole("button", { name: /collapse panel/i });
      now = 0;
      fireEvent.pointerDown(grabber, { clientY: 300, pointerId: 1 });
      fireEvent.pointerMove(grabber, { clientY: 200, pointerId: 1 }); // dy=-100 → live height 500px
      expect(panel.style.height).toBe("500px");
      now = 2000;
      fireEvent.pointerUp(grabber, { clientY: 200, pointerId: 1 });
      expect(panel.style.height).toBe("");
    });

    it("pointercancel clears the live-drag height and commits no snap", () => {
      const onSnap = vi.fn();
      const { container, props } = renderSheet({ isMobile: true, collapsed: false, snap: "half", onSnap });
      const panel = mockPanelHeight(container, 400);
      const grabber = screen.getByRole("button", { name: /collapse panel/i });
      now = 0;
      fireEvent.pointerDown(grabber, { clientY: 300, pointerId: 1 });
      fireEvent.pointerMove(grabber, { clientY: 200, pointerId: 1 });
      expect(panel.style.height).not.toBe("");
      fireEvent.pointerCancel(grabber, { clientY: 200, pointerId: 1 });
      expect(panel.style.height).toBe("");
      // a stray pointerup after cancel is a no-op: drag state is already cleared
      fireEvent.pointerUp(grabber, { clientY: 100, pointerId: 1 });
      expect(onSnap).not.toHaveBeenCalled();
      expect(props.onToggleCollapsed).not.toHaveBeenCalled();
    });
  });
});

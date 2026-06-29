// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./drawerStorage", () => ({
  loadDrawerState: () => ({ collapsed: false, widthPx: 360 }),
  saveDrawerState: vi.fn(),
}));

import { useDrawer } from "./useDrawer";
import { clampWidth, DRAWER_WIDE } from "./drawer";

describe("useDrawer", () => {
  it("starts from the persisted drawer state", () => {
    const { result } = renderHook(() => useDrawer());
    expect(result.current.drawer).toEqual({ collapsed: false, widthPx: 360 });
  });

  it("toggles the collapsed flag", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onToggleCollapsed());
    expect(result.current.drawer.collapsed).toBe(true);
    act(() => result.current.onToggleCollapsed());
    expect(result.current.drawer.collapsed).toBe(false);
  });

  it("setCollapsed forces the flag (used by the add-pin flow)", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.setCollapsed(true));
    expect(result.current.drawer.collapsed).toBe(true);
    act(() => result.current.setCollapsed(false));
    expect(result.current.drawer.collapsed).toBe(false);
  });

  it("peek preset collapses; wide preset opens at the clamped wide width", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onPreset("peek"));
    expect(result.current.drawer.collapsed).toBe(true);
    act(() => result.current.onPreset("wide"));
    expect(result.current.drawer).toEqual({ collapsed: false, widthPx: clampWidth(DRAWER_WIDE) });
  });

  it("onResize clamps the requested width", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onResize(100000));
    expect(result.current.drawer.widthPx).toBe(clampWidth(100000));
    expect(result.current.drawer.widthPx).toBeLessThan(100000);
  });
});

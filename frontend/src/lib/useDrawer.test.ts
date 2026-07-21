// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { saveDrawerState } = vi.hoisted(() => ({ saveDrawerState: vi.fn() }));
vi.mock("./drawerStorage", () => ({
  loadDrawerState: () => ({ collapsed: false, widthPx: 360, snap: "half" }),
  saveDrawerState,
}));

import { useDrawer } from "./useDrawer";
import { clampWidth, DRAWER_WIDE } from "./drawer";

describe("useDrawer", () => {
  it("starts from the persisted drawer state", () => {
    const { result } = renderHook(() => useDrawer());
    expect(result.current.drawer).toEqual({ collapsed: false, widthPx: 360, snap: "half" });
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

  it("wide and default actions set the corresponding open width", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onPreset("wide"));
    expect(result.current.drawer).toEqual({ collapsed: false, widthPx: clampWidth(DRAWER_WIDE), snap: "half" });
    act(() => result.current.onPreset("default"));
    expect(result.current.drawer).toEqual({ collapsed: false, widthPx: 400, snap: "half" });
  });

  it("onResize clamps the requested width", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onResize(100000));
    expect(result.current.drawer.widthPx).toBe(clampWidth(100000));
    expect(result.current.drawer.widthPx).toBeLessThan(100000);
  });

  // --- snap invariant: collapsed ⇔ snap === "bar" at all times ---

  it("onSnap('bar') collapses; onSnap('half'|'full') un-collapses", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onSnap("bar"));
    expect(result.current.drawer).toMatchObject({ collapsed: true, snap: "bar" });
    act(() => result.current.onSnap("full"));
    expect(result.current.drawer).toMatchObject({ collapsed: false, snap: "full" });
    act(() => result.current.onSnap("half"));
    expect(result.current.drawer).toMatchObject({ collapsed: false, snap: "half" });
  });

  it("setCollapsed(true) drops to bar; setCollapsed(false) promotes bar→half only", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onSnap("full"));
    act(() => result.current.setCollapsed(true));
    expect(result.current.drawer).toMatchObject({ collapsed: true, snap: "bar" });
    // promotion out of bar lands on half, never restores the prior expanded snap
    act(() => result.current.setCollapsed(false));
    expect(result.current.drawer).toMatchObject({ collapsed: false, snap: "half" });
  });

  it("setCollapsed(false) leaves an already-expanded (full) sheet at full", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onSnap("full"));
    act(() => result.current.setCollapsed(false));
    expect(result.current.drawer).toMatchObject({ collapsed: false, snap: "full" });
  });

  it("onToggleCollapsed toggles bar ↔ the last expanded snap (full, not the default half)", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onSnap("full")); // last expanded snap becomes full
    act(() => result.current.onToggleCollapsed()); // collapse to bar
    expect(result.current.drawer).toMatchObject({ collapsed: true, snap: "bar" });
    act(() => result.current.onToggleCollapsed()); // expand restores full
    expect(result.current.drawer).toMatchObject({ collapsed: false, snap: "full" });
  });

  it("onToggleCollapsed expands a bar-seeded sheet to the default half", () => {
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onSnap("bar"));
    act(() => result.current.onToggleCollapsed());
    expect(result.current.drawer).toMatchObject({ collapsed: false, snap: "half" });
  });

  it("persists the snap through the write-back effect", () => {
    saveDrawerState.mockClear();
    const { result } = renderHook(() => useDrawer());
    act(() => result.current.onSnap("full"));
    expect(saveDrawerState).toHaveBeenLastCalledWith(expect.objectContaining({ snap: "full", collapsed: false }));
  });
});

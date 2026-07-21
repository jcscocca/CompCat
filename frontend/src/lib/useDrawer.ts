import { useEffect, useRef, useState } from "react";

import { clampWidth, DRAWER_DEFAULT, DRAWER_WIDE, type DrawerPreset } from "./drawer";
import { loadDrawerState, saveDrawerState } from "./drawerStorage";
import type { DrawerState, SheetSnap } from "../types";

export interface DrawerController {
  drawer: DrawerState;
  /** Collapse/expand the drawer (used by the add-pin flow). */
  setCollapsed: (collapsed: boolean) => void;
  onResize: (px: number) => void;
  onToggleCollapsed: () => void;
  onPreset: (preset: DrawerPreset) => void;
  /** Move the mobile sheet to a snap height; keeps `collapsed` in sync (bar ⇔ collapsed). */
  onSnap: (snap: SheetSnap) => void;
}

/**
 * Owns the resizable side-drawer: its persisted width/collapsed/snap state, the
 * localStorage write-back, and the window-resize clamp. The workspace shell renders
 * the drawer and the add-pin flow toggles `setCollapsed`; nothing else touches it.
 *
 * Invariant enforced by every setter: `collapsed` is true iff `snap === "bar"`.
 * `lastExpandedRef` remembers the snap to restore when a tap re-expands the sheet.
 */
export function useDrawer(): DrawerController {
  const [drawer, setDrawer] = useState<DrawerState>(() => loadDrawerState());
  const lastExpandedRef = useRef<SheetSnap>(drawer.snap === "bar" ? "half" : drawer.snap);

  useEffect(() => {
    saveDrawerState(drawer);
  }, [drawer]);

  useEffect(() => {
    function onResize() {
      setDrawer((current) => ({ ...current, widthPx: clampWidth(current.widthPx) }));
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return {
    drawer,
    setCollapsed: (collapsed) =>
      setDrawer((current) => {
        if (collapsed) return { ...current, collapsed: true, snap: "bar" };
        const snap = current.snap === "bar" ? "half" : current.snap;
        lastExpandedRef.current = snap;
        return { ...current, collapsed: false, snap };
      }),
    onResize: (px) => setDrawer((current) => ({ ...current, widthPx: clampWidth(px) })),
    onToggleCollapsed: () =>
      setDrawer((current) => {
        if (current.collapsed) return { ...current, collapsed: false, snap: lastExpandedRef.current };
        lastExpandedRef.current = current.snap;
        return { ...current, collapsed: true, snap: "bar" };
      }),
    onPreset: (preset) =>
      setDrawer((current) => {
        const snap = current.snap === "bar" ? "half" : current.snap;
        lastExpandedRef.current = snap;
        return { collapsed: false, widthPx: clampWidth(preset === "wide" ? DRAWER_WIDE : DRAWER_DEFAULT), snap };
      }),
    onSnap: (snap) =>
      setDrawer((current) => {
        if (snap === "bar") return { ...current, collapsed: true, snap: "bar" };
        lastExpandedRef.current = snap;
        return { ...current, collapsed: false, snap };
      }),
  };
}

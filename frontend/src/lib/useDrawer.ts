import { useEffect, useState } from "react";

import { clampWidth, drawerMax, DRAWER_DEFAULT, DRAWER_WIDE, type DrawerPreset } from "./drawer";
import { loadDrawerState, saveDrawerState } from "./drawerStorage";
import type { DrawerState } from "../types";

export interface DrawerController {
  drawer: DrawerState;
  /** Collapse/expand the drawer (used by the add-pin flow). */
  setCollapsed: (collapsed: boolean) => void;
  onResize: (px: number) => void;
  onToggleCollapsed: () => void;
  onPreset: (preset: DrawerPreset) => void;
}

/**
 * Owns the resizable side-drawer: its persisted width/collapsed state, the
 * localStorage write-back, and the window-resize clamp. The workspace shell renders
 * the drawer and the add-pin flow toggles `setCollapsed`; nothing else touches it.
 */
export function useDrawer(): DrawerController {
  const [drawer, setDrawer] = useState<DrawerState>(() => loadDrawerState());

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
    setCollapsed: (collapsed) => setDrawer((current) => ({ ...current, collapsed })),
    onResize: (px) => setDrawer((current) => ({ ...current, widthPx: clampWidth(px) })),
    onToggleCollapsed: () => setDrawer((current) => ({ ...current, collapsed: !current.collapsed })),
    onPreset: (preset) =>
      setDrawer((current) => {
        if (preset === "peek") return { ...current, collapsed: true };
        if (preset === "focus") return { collapsed: false, widthPx: drawerMax() };
        return { collapsed: false, widthPx: clampWidth(preset === "wide" ? DRAWER_WIDE : DRAWER_DEFAULT) };
      }),
  };
}

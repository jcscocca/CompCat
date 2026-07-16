import type { DrawerState } from "../types";
import { clampWidth, DRAWER_DEFAULT } from "./drawer";

const WIDTH_KEY = "compcat.drawer.width";
const COLLAPSED_KEY = "compcat.drawer.collapsed";

export function loadDrawerState(): DrawerState {
  try {
    const rawWidth = localStorage.getItem(WIDTH_KEY);
    const rawCollapsed = localStorage.getItem(COLLAPSED_KEY);
    const widthPx = rawWidth === null ? DRAWER_DEFAULT : clampWidth(Number(rawWidth));
    return { collapsed: rawCollapsed === "true", widthPx };
  } catch {
    return { collapsed: false, widthPx: DRAWER_DEFAULT };
  }
}

export function saveDrawerState(state: DrawerState): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(state.widthPx));
    localStorage.setItem(COLLAPSED_KEY, String(state.collapsed));
  } catch {
    // ignore: private mode or disabled storage degrades to in-memory defaults
  }
}

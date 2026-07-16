export const DRAWER_MIN = 340;
export const DRAWER_DEFAULT = 400;
export const DRAWER_WIDE = 640;
export const DRAWER_PEEK = 84;
export const DRAWER_RESIZE_STEP = 24;
// Focus mode (and manual drag) always leave this much live map at the left edge.
export const MAP_STRIP_MIN = 96;
// Below this much visible map strip, map-reading chrome (legend, search, zoom) is shed
// and the topbar stacks vertically inside the strip. 240 ≈ legend width + margins.
export const FOCUS_CHROME_MIN = 240;

// Viewports at/below this width render the workspace panel as a bottom sheet.
// Must match the `@media (max-width:760px)` breakpoint in styles/mapWorkspace.css.
export const MOBILE_MAX_WIDTH = 760;

export type DrawerPreset = "peek" | "default" | "wide" | "focus";

export function drawerMax(): number {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  return Math.max(DRAWER_MIN, Math.min(Math.round(vw) - MAP_STRIP_MIN, Math.round(vw * 0.9)));
}

export function clampWidth(px: number): number {
  if (!Number.isFinite(px)) return DRAWER_DEFAULT;
  return Math.min(drawerMax(), Math.max(DRAWER_MIN, Math.round(px)));
}

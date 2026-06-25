export const DRAWER_MIN = 340;
export const DRAWER_DEFAULT = 400;
export const DRAWER_WIDE = 640;
export const DRAWER_PEEK = 84;
export const DRAWER_RESIZE_STEP = 24;

export type DrawerPreset = "peek" | "default" | "wide";

export function drawerMax(): number {
  const vw = typeof window === "undefined" ? 1280 : window.innerWidth;
  return Math.max(DRAWER_MIN, Math.min(720, Math.round(vw * 0.72)));
}

export function clampWidth(px: number): number {
  if (!Number.isFinite(px)) return DRAWER_DEFAULT;
  return Math.min(drawerMax(), Math.max(DRAWER_MIN, Math.round(px)));
}

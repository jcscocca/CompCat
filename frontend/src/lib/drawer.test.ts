// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { clampWidth, drawerMax, DRAWER_DEFAULT, DRAWER_MIN } from "./drawer";

function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true, writable: true });
}

afterEach(() => setViewport(1024));

describe("drawer math", () => {
  it("exposes the expected default expanded width", () => {
    expect(DRAWER_DEFAULT).toBe(400);
    expect(DRAWER_MIN).toBe(340);
  });

  it("caps drawerMax at 72% of the viewport, never above 720", () => {
    setViewport(800);
    expect(drawerMax()).toBe(576);
    setViewport(2000);
    expect(drawerMax()).toBe(720);
  });

  it("clamps width into [DRAWER_MIN, drawerMax]", () => {
    setViewport(1200);
    expect(clampWidth(100)).toBe(DRAWER_MIN);
    expect(clampWidth(5000)).toBe(drawerMax());
    expect(clampWidth(512.6)).toBe(513);
  });
});

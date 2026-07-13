// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { DRAWER_DEFAULT } from "./drawer";
import { loadDrawerState, saveDrawerState } from "./drawerStorage";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("drawer storage", () => {
  it("defaults to an open drawer at the default width when nothing is stored", () => {
    expect(loadDrawerState()).toEqual({ collapsed: false, widthPx: DRAWER_DEFAULT });
  });

  it("round-trips a saved state, clamping the width", () => {
    saveDrawerState({ collapsed: true, widthPx: 99999 });
    const loaded = loadDrawerState();
    expect(loaded.collapsed).toBe(true);
    // jsdom window.innerWidth defaults to 1024, so drawerMax() == min(1024-96, 1024*0.9) == 922
    expect(loaded.widthPx).toBe(922);
  });

  it("falls back to defaults when storage throws", () => {
    const getItem = vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(loadDrawerState()).toEqual({ collapsed: false, widthPx: DRAWER_DEFAULT });
    expect(getItem).toHaveBeenCalled();
  });
});

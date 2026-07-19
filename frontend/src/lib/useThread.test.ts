// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { THREAD_CAP, useThread } from "./useThread";

describe("useThread", () => {
  it("appends items in order", () => {
    const { result } = renderHook(() => useThread());
    act(() => result.current.append({ kind: "user_text", text: "hi" }));
    act(() => result.current.append({ kind: "receipt", text: "Search radius → 500 m" }));
    expect(result.current.items).toEqual([
      { kind: "user_text", text: "hi" },
      { kind: "receipt", text: "Search radius → 500 m" },
    ]);
  });

  it("keeps append identity stable across renders", () => {
    const { result, rerender } = renderHook(() => useThread());
    const first = result.current.append;
    rerender();
    expect(result.current.append).toBe(first);
  });

  it("caps the thread at THREAD_CAP items, dropping the oldest", () => {
    const { result } = renderHook(() => useThread());
    act(() => {
      for (let i = 0; i < THREAD_CAP + 5; i += 1) {
        result.current.append({ kind: "receipt", text: `r${i}` });
      }
    });
    expect(result.current.items).toHaveLength(THREAD_CAP);
    expect(result.current.items[0]).toEqual({ kind: "receipt", text: "r5" });
  });
});

// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { THREAD_CAP, useThread } from "./useThread";
import type { AnalysisCardData } from "../types";

const localCard: AnalysisCardData = {
  runId: null,
  kind: "analyze",
  placeIds: ["p1"],
  settings: {
    radius_m: 250,
    analysis_start_date: "2026-01-01",
    analysis_end_date: "2026-07-29",
    offense_category: null,
    layer: "reported",
  },
  comparison: null,
  neighborhood: null,
  incidents: null,
};

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

  it("replaces one analysis card without disturbing the rest of the thread", () => {
    const assistantCard: AnalysisCardData = { ...localCard, runId: "run-assistant" };
    const replacement: AnalysisCardData = {
      ...localCard,
      settings: { ...localCard.settings, radius_m: 500 },
    };
    const { result } = renderHook(() => useThread());

    act(() => result.current.append({ kind: "tabby_text", text: "Here is the context." }));
    act(() => result.current.append({ kind: "analysis_card", card: assistantCard }));
    act(() => result.current.append({ kind: "analysis_card", card: localCard }));
    act(() => result.current.replaceAnalysisCard(localCard, replacement));

    expect(result.current.items).toEqual([
      { kind: "tabby_text", text: "Here is the context." },
      { kind: "analysis_card", card: assistantCard },
      { kind: "analysis_card", card: replacement },
    ]);
  });

  it("keeps replaceAnalysisCard identity stable across renders", () => {
    const { result, rerender } = renderHook(() => useThread());
    const first = result.current.replaceAnalysisCard;
    rerender();
    expect(result.current.replaceAnalysisCard).toBe(first);
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

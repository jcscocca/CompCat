// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCompare } from "./useCompare";

vi.mock("../api/client", () => ({ comparePlaces: vi.fn().mockResolvedValue({} as unknown) }));
import { comparePlaces } from "../api/client";

const analysis = { startDate: "2024-01-01", endDate: "2024-01-31", radiusM: 250, offenseCategory: "", layer: "reported" as const };

afterEach(() => vi.clearAllMocks());

describe("useCompare shared-view points", () => {
  it("sends points (not place_ids) when a points override is provided", async () => {
    const points = [
      { latitude: 47.61, longitude: -122.34, label: "A" },
      { latitude: 47.62, longitude: -122.33, label: "B" },
    ];
    const { result } = renderHook(() =>
      useCompare({ selectedIds: new Set(), analysis, setError: vi.fn(), points }));
    await act(async () => { await result.current.runCompare(); });
    expect(comparePlaces).toHaveBeenCalledWith(expect.objectContaining({ points }));
    expect((comparePlaces as ReturnType<typeof vi.fn>).mock.calls[0][0].place_ids).toBeUndefined();
  });
});

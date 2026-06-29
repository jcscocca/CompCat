import { afterEach, describe, expect, it, vi } from "vitest";

import { createPlace, deletePlace, getDashboardFreshness, getDashboardSummary, streamAssistantChat } from "./client";
import type { AssistantDashboardState } from "../types";

afterEach(() => {
  vi.restoreAllMocks();
});

const emptyDashboardState: AssistantDashboardState = {
  selected_place_ids: [],
  analysis_start_date: null,
  analysis_end_date: null,
  radii_m: [],
  offense_category: null,
  offense_subcategory: null,
  nibrs_group: null,
};

function sseResponse(text: string): Response {
  return new Response(text, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("api client", () => {
  it("creates places with JSON and cookie credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "place-1", display_label: "Library" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await createPlace({
      display_label: "Library",
      latitude: 47.621,
      longitude: -122.321,
      visit_count: 4,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/places",
      expect.objectContaining({
        body: JSON.stringify({
          display_label: "Library",
          latitude: 47.621,
          longitude: -122.321,
          visit_count: 4,
        }),
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        method: "POST",
      }),
    );
  });

  it("returns undefined for delete responses without content", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

    await expect(deletePlace("place-1")).resolves.toBeUndefined();
  });

  it("throws response text when a request fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("No session", { status: 401 }));

    await expect(getDashboardSummary()).rejects.toThrow("No session");
  });

  it("throws a status fallback when a failed request has no response text", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    await expect(getDashboardSummary()).rejects.toThrow("Request failed with status 500");
  });

  it("fetches dashboard freshness from the public endpoint", async () => {
    const payload = {
      incident_count: 5,
      data_through: "2026-06-22",
      earliest: "2008-01-01",
      last_ingested_at: "2026-06-23T00:00:00Z",
    };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(getDashboardFreshness()).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledWith(
      "/dashboard/freshness",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("skips a malformed assistant SSE frame and still delivers later valid events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        "event: token\ndata: not-json\n\n" +
          'event: token\ndata: {"delta":"ok"}\n\n' +
          "event: done\ndata: {}\n\n",
      ),
    );

    const deltas: string[] = [];
    let sawDone = false;
    await streamAssistantChat(
      { messages: [{ role: "user", content: "hi" }], dashboard_state: emptyDashboardState },
      {
        onEvent: (event) => {
          if (event.event === "token") deltas.push(event.data.delta ?? "");
          if (event.event === "done") sawDone = true;
        },
      },
    );

    expect(deltas).toEqual(["ok"]);
    expect(sawDone).toBe(true);
  });

  it("still surfaces a terminal error event when its data is malformed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse('event: token\ndata: {"delta":"partial"}\n\n' + "event: error\ndata: not-json\n\n"),
    );

    const events: string[] = [];
    await streamAssistantChat(
      { messages: [{ role: "user", content: "hi" }], dashboard_state: emptyDashboardState },
      { onEvent: (event) => events.push(event.event) },
    );

    // A malformed *token* frame is dropped, but a terminal error must never be swallowed
    // or the user sees neither an answer nor an error.
    expect(events).toContain("error");
  });
});

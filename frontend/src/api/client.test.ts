import { afterEach, describe, expect, it, vi } from "vitest";

import { createPlace, deletePlace, friendlyMessageOr, friendlyRequestError, getDashboardFreshness, getDashboardSummary, getTrends, isFriendlyRequestError, isSessionExpired, streamAssistantChat, streamAssistantCommand, uploadPersonalData, GENERIC_ERROR_MESSAGE, RATE_LIMITED_MESSAGE, SERVER_ERROR_MESSAGE, SESSION_EXPIRED_MESSAGE } from "./client";
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
  layer: "reported",
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

  it("maps 401 to the session-expired line and never leaks the body", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Missing or invalid session cookie" }), { status: 401 }),
    );

    await expect(getDashboardSummary()).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    // The body is still available for debugging, just never in the thrown message.
    expect(debug).toHaveBeenCalled();
  });

  it("maps 429 to the retry line", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Request limit reached — please retry shortly." }), { status: 429 }),
    );

    await expect(getDashboardSummary()).rejects.toThrow(RATE_LIMITED_MESSAGE);
  });

  it("maps 5xx to the our-side line", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<html><body>502 Bad Gateway</body></html>", { status: 502 }),
    );

    await expect(getDashboardSummary()).rejects.toThrow(SERVER_ERROR_MESSAGE);
  });

  it("maps a network failure to the our-side line", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(getDashboardSummary()).rejects.toThrow(SERVER_ERROR_MESSAGE);
  });

  it("maps any other failing status to the generic retry line", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "csv_text must not be empty" }), { status: 422 }),
    );

    await expect(getDashboardSummary()).rejects.toThrow(GENERIC_ERROR_MESSAGE);
  });

  it("never surfaces a JSON detail body from any failing status", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 503]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ detail: "leaky-internal-detail" }), { status }),
      );
      await expect(getDashboardSummary()).rejects.toThrow(
        expect.not.stringContaining("leaky-internal-detail") as unknown as string,
      );
    }
  });

  it("re-throws abort errors untouched so cancelled requests stay control flow", async () => {
    const abort = new DOMException("The user aborted a request.", "AbortError");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(abort);

    await expect(getDashboardSummary()).rejects.toBe(abort);
  });

  it("maps upload failures too (uploadPersonalData bypasses request())", async () => {
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ detail: "Unsupported location-history format" }), { status: 422 }),
    );

    await expect(uploadPersonalData(new File(["{}"], "t.json"))).rejects.toThrow(GENERIC_ERROR_MESSAGE);
  });

  it("fetches dashboard freshness from the public endpoint", async () => {
    const payload = {
      reported: {
        incident_count: 5,
        data_through: "2026-06-22",
        earliest: "2008-01-01",
        last_ingested_at: "2026-06-23T00:00:00Z",
      },
      calls: {
        incident_count: 2,
        data_through: "2026-06-20",
        earliest: "2024-07-01",
        last_ingested_at: "2026-06-23T00:00:00Z",
      },
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

  it("builds the trends querystring and sends cookie credentials", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ months: [], area_counts: [], citywide_counts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await getTrends({ mcpp: "TEST HILL", layer: "reported", category: "PROPERTY" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/dashboard/trends?mcpp=TEST+HILL&layer=reported&category=PROPERTY",
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("omits the category param when none is given", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ months: [], area_counts: [], citywide_counts: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await getTrends({ mcpp: "BALLARD", layer: "calls" });

    expect(fetchMock).toHaveBeenCalledWith(
      "/dashboard/trends?mcpp=BALLARD&layer=calls",
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

  it("maps a failing assistant stream response to friendly copy, never the body", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ detail: "leaky-internal-detail" }), { status: 429 }),
    );

    const failure = await streamAssistantChat(
      { messages: [{ role: "user", content: "hi" }], dashboard_state: emptyDashboardState },
      { onEvent: () => {} },
    ).then(
      () => null,
      (error: unknown) => error as Error,
    );

    expect(failure?.message).toBe(RATE_LIMITED_MESSAGE);
    expect(failure?.message).not.toContain("leaky-internal-detail");
    expect(debug).toHaveBeenCalled();
  });

  it("passes the abort signal through to fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(sseResponse("event: done\ndata: {}\n\n"));

    await streamAssistantChat(
      { messages: [{ role: "user", content: "hi" }], dashboard_state: emptyDashboardState },
      { onEvent: () => {} },
      controller.signal,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "/assistant/chat",
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("streams command events from /assistant/commands", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      sseResponse(
        'event: meta\ndata: {"mode":"command","command":"suggest_followups"}\n\n' +
          'event: tool\ndata: {"tool_name":"suggest_followups","arguments":{},"result":{"suggestions":["a"]}}\n\n' +
          'event: token\ndata: {"delta":"Here are follow-ups."}\n\n' +
          "event: done\ndata: {}\n\n",
      ),
    );

    const events: string[] = [];
    await streamAssistantCommand(
      { command: "suggest_followups", arguments: {} },
      { onEvent: (event) => events.push(event.event) },
    );

    expect(fetchMock.mock.calls[0][0]).toContain("/assistant/commands");
    expect(events).toEqual(["meta", "tool", "token", "done"]);
  });
});

describe("failure-message helpers", () => {
  it("recognises only the messages `request` itself throws", () => {
    for (const message of [SESSION_EXPIRED_MESSAGE, RATE_LIMITED_MESSAGE, SERVER_ERROR_MESSAGE, GENERIC_ERROR_MESSAGE]) {
      expect(isFriendlyRequestError(new Error(message))).toBe(true);
    }
    // Anything else could be a raw response body or a stack trace — never renderable.
    expect(isFriendlyRequestError(new Error("<html>502 Bad Gateway</html>"))).toBe(false);
    expect(isFriendlyRequestError("a string")).toBe(false);
    expect(isFriendlyRequestError(null)).toBe(false);
  });

  it("prefers the status-mapped message over the caller's fallback", () => {
    expect(friendlyMessageOr(new Error(SESSION_EXPIRED_MESSAGE), "generic")).toBe(SESSION_EXPIRED_MESSAGE);
    expect(friendlyMessageOr(new Error(RATE_LIMITED_MESSAGE), "generic")).toBe(RATE_LIMITED_MESSAGE);
    expect(friendlyMessageOr(new Error("kaboom"), "generic")).toBe("generic");
    expect(friendlyMessageOr(undefined, "generic")).toBe("generic");
  });

  it("identifies an expired session, which only a reload can fix", () => {
    expect(isSessionExpired(new Error(SESSION_EXPIRED_MESSAGE))).toBe(true);
    expect(isSessionExpired(new Error(SERVER_ERROR_MESSAGE))).toBe(false);
    expect(friendlyRequestError(401)).toBe(SESSION_EXPIRED_MESSAGE);
  });
});

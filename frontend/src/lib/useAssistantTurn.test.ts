// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  streamAssistantChat: vi.fn(),
  streamAssistantCommand: vi.fn(),
}));

import { streamAssistantChat, streamAssistantCommand } from "../api/client";
import { COMMAND_FAILURE_MESSAGE, useAssistantTurn, OFFLINE_MESSAGE } from "./useAssistantTurn";
import type { ThreadItem } from "./threadItems";
import type { AssistantDashboardState, AssistantStreamEvent } from "../types";

const dashboardState: AssistantDashboardState = {
  selected_place_ids: [], analysis_start_date: null, analysis_end_date: null,
  radii_m: [250], offense_category: null, offense_subcategory: null,
  nibrs_group: null, layer: "reported",
};

function setup(items: ThreadItem[] = []) {
  const append = vi.fn();
  const onToolResult = vi.fn();
  const hook = renderHook(() =>
    useAssistantTurn({ dashboardState, items, append, onToolResult }),
  );
  return { hook, append, onToolResult };
}

beforeEach(() => {
  vi.mocked(streamAssistantChat).mockReset();
  vi.mocked(streamAssistantCommand).mockReset();
});

describe("useAssistantTurn", () => {
  it("sendChat appends user turn, streams, commits the reply", async () => {
    vi.mocked(streamAssistantChat).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "token", data: { delta: "On it." } });
      onEvent({ event: "done", data: {} });
    });
    const { hook, append } = setup();
    await act(() => hook.result.current.sendChat("analyze Home"));
    expect(append).toHaveBeenCalledWith({ kind: "user_text", text: "analyze Home" });
    expect(append).toHaveBeenCalledWith({ kind: "tabby_text", text: "On it." });
    expect(hook.result.current.offline).toBe(false);
  });

  it("llm_unreachable error on chat sets offline and appends the notice", async () => {
    vi.mocked(streamAssistantChat).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "error", data: { message: "Couldn't reach the analyst.", code: "llm_unreachable" } });
    });
    const { hook, append } = setup();
    await act(() => hook.result.current.sendChat("hi"));
    expect(append).toHaveBeenCalledWith({ kind: "notice", text: "Couldn't reach the analyst." });
    expect(hook.result.current.offline).toBe(true);
  });

  it("a successful chat clears offline", async () => {
    vi.mocked(streamAssistantChat)
      .mockImplementationOnce(async (_p, { onEvent }) => {
        onEvent({ event: "error", data: { code: "llm_unreachable", message: "down" } });
      })
      .mockImplementationOnce(async (_p, { onEvent }) => {
        onEvent({ event: "token", data: { delta: "Back." } });
      });
    const { hook } = setup();
    await act(() => hook.result.current.sendChat("hi"));
    expect(hook.result.current.offline).toBe(true);
    await act(() => hook.result.current.sendChat(null));
    expect(hook.result.current.offline).toBe(false);
  });

  it("runCommand streams the command, forwards tool events, never flips offline", async () => {
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "tool", data: { tool_name: "update_filters", arguments: {}, result: { patch: { radius_m: 500 } } } });
      onEvent({ event: "error", data: { message: "boom", code: "tool_error" } });
    });
    const { hook, append, onToolResult } = setup();
    await act(() => hook.result.current.runCommand("Widen radius", "update_filters", { radius_m: 500 }));
    expect(append).toHaveBeenCalledWith({ kind: "user_text", text: "Widen radius" });
    expect(onToolResult).toHaveBeenCalledWith(expect.objectContaining({ tool_name: "update_filters" }));
    expect(append).toHaveBeenCalledWith({ kind: "notice", text: "boom" });
    expect(hook.result.current.offline).toBe(false);
    expect(vi.mocked(streamAssistantCommand).mock.calls[0][0]).toEqual({
      command: "update_filters",
      arguments: { radius_m: 500 },
    });
  });

  it("suppresses the summary for a settings-only command turn (the receipt covers it)", async () => {
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "tool", data: { tool_name: "update_filters", arguments: {}, result: { patch: { radius_m: 500 } } } });
      onEvent({ event: "token", data: { delta: "Updated the filters: radius 500 m." } });
      onEvent({ event: "done", data: {} });
    });
    const { hook, append } = setup();
    await act(() => hook.result.current.runCommand("Widen radius", "update_filters", { radius_m: 500 }));
    expect(append).toHaveBeenCalledWith({ kind: "user_text", text: "Widen radius" });
    expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "tabby_text" }));
  });

  it("still commits the reply for a command turn that ran a non-settings tool", async () => {
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "tool", data: { tool_name: "analyze_places", arguments: {}, result: {} } });
      onEvent({ event: "token", data: { delta: "Analyzed Home." } });
      onEvent({ event: "done", data: {} });
    });
    const { hook, append } = setup();
    await act(() => hook.result.current.runCommand("Analyze", "analyze_places", {}));
    expect(append).toHaveBeenCalledWith({ kind: "tabby_text", text: "Analyzed Home." });
  });

  it("a chat turn commits its reply even when a settings tool ran", async () => {
    vi.mocked(streamAssistantChat).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "tool", data: { tool_name: "update_filters", arguments: {}, result: {} } });
      onEvent({ event: "token", data: { delta: "Done." } });
    });
    const { hook, append } = setup();
    await act(() => hook.result.current.sendChat("widen the radius"));
    expect(append).toHaveBeenCalledWith({ kind: "tabby_text", text: "Done." });
  });

  it("a thrown fetch on chat appends OFFLINE_MESSAGE and sets offline", async () => {
    vi.mocked(streamAssistantChat).mockRejectedValue(new Error("network"));
    const { hook, append } = setup();
    await act(() => hook.result.current.sendChat("hi"));
    expect(append).toHaveBeenCalledWith({ kind: "notice", text: OFFLINE_MESSAGE });
    expect(hook.result.current.offline).toBe(true);
  });

  it("a thrown command transport uses a command notice and leaves chat online", async () => {
    vi.mocked(streamAssistantCommand).mockRejectedValue(new Error("rate limited"));
    const { hook, append } = setup();
    await act(() => hook.result.current.runCommand("Analyze", "analyze_places", {}));
    expect(append).toHaveBeenCalledWith({ kind: "notice", text: COMMAND_FAILURE_MESSAGE });
    expect(append).not.toHaveBeenCalledWith({ kind: "notice", text: OFFLINE_MESSAGE });
    expect(hook.result.current.offline).toBe(false);
  });

  it("aborts the in-flight turn and runs the new one (newest intent wins)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(streamAssistantChat)
      .mockImplementationOnce(async (_p, { onEvent }) => {
        onEvent({ event: "token", data: { delta: "first…" } });
        await gate;
      })
      .mockImplementationOnce(async (_p, { onEvent }) => {
        onEvent({ event: "token", data: { delta: "second." } });
        onEvent({ event: "done", data: {} });
      });
    const { hook, append } = setup();
    let first!: Promise<void>;
    act(() => { first = hook.result.current.sendChat("one"); });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    await act(() => hook.result.current.sendChat("two"));

    // The first stream's signal was aborted; both streams ran.
    expect(vi.mocked(streamAssistantChat).mock.calls[0][2]?.aborted).toBe(true);
    expect(vi.mocked(streamAssistantChat)).toHaveBeenCalledTimes(2);
    // Both user turns were sent, so both stay in the thread; only the live turn commits.
    expect(append).toHaveBeenCalledWith({ kind: "user_text", text: "one" });
    expect(append).toHaveBeenCalledWith({ kind: "user_text", text: "two" });
    expect(append).toHaveBeenCalledWith({ kind: "tabby_text", text: "second." });
    expect(append).not.toHaveBeenCalledWith({ kind: "tabby_text", text: "first…" });

    release();
    await act(() => first);
    expect(hook.result.current.busy).toBe(false);
  });

  it("an aborted turn appends no notice and leaves offline untouched", async () => {
    vi.mocked(streamAssistantChat)
      .mockImplementationOnce((_p, { onEvent }, signal) =>
        new Promise((_resolve, reject) => {
          onEvent({ event: "token", data: { delta: "partial" } });
          signal?.addEventListener("abort", () => {
            const err = new Error("The user aborted a request.");
            err.name = "AbortError";
            reject(err);
          });
        }),
      )
      .mockImplementationOnce(async (_p, { onEvent }) => {
        onEvent({ event: "token", data: { delta: "second." } });
        onEvent({ event: "done", data: {} });
      });
    const { hook, append } = setup();
    let first!: Promise<void>;
    act(() => { first = hook.result.current.sendChat("one"); });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    await act(() => hook.result.current.sendChat("two"));

    // The first turn rejected with an AbortError but must add no notice and not flip offline.
    expect(append).not.toHaveBeenCalledWith(expect.objectContaining({ kind: "notice" }));
    expect(hook.result.current.offline).toBe(false);
    await act(() => first);
  });

  it("ignores stale events emitted by an aborted turn", async () => {
    let staleEmit!: (event: AssistantStreamEvent) => void;
    let release2!: () => void;
    const gate1 = new Promise<void>(() => {}); // first turn never settles on its own
    const gate2 = new Promise<void>((r) => (release2 = r));
    vi.mocked(streamAssistantChat)
      .mockImplementationOnce(async (_p, { onEvent }) => {
        staleEmit = onEvent;
        onEvent({ event: "token", data: { delta: "stale-1" } });
        await gate1;
      })
      .mockImplementationOnce(async (_p, { onEvent }) => {
        onEvent({ event: "token", data: { delta: "fresh" } });
        await gate2;
      });
    const { hook } = setup();
    act(() => { void hook.result.current.sendChat("one"); });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    await act(() => { void hook.result.current.sendChat("two"); });
    await waitFor(() => expect(hook.result.current.draft).toBe("fresh"));

    // The aborted first turn keeps streaming — its tokens must not touch the live draft.
    act(() => { staleEmit({ event: "token", data: { delta: "stale-2" } }); });
    expect(hook.result.current.draft).toBe("fresh");

    await act(async () => { release2(); });
  });

  it("does not dedupe a rapid double-run of the same chip — abort-and-replace supersedes it", async () => {
    // Newest-intent-wins deliberately drops the slice-2 in-flight guard: a double-click
    // aborts the first turn and runs the second, so both streams fire and both user turns
    // are appended rather than the second being silently ignored.
    vi.mocked(streamAssistantCommand).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "token", data: { delta: "done" } });
      onEvent({ event: "done", data: {} });
    });
    const { hook, append } = setup();
    await act(async () => {
      void hook.result.current.runCommand("Widen to 500 m", "analyze_places", { radii_m: [500] });
      void hook.result.current.runCommand("Widen to 500 m", "analyze_places", { radii_m: [500] });
    });

    expect(vi.mocked(streamAssistantCommand)).toHaveBeenCalledTimes(2);
    const userTurns = append.mock.calls.filter(([item]) => item.kind === "user_text");
    expect(userTurns).toHaveLength(2);
  });
});

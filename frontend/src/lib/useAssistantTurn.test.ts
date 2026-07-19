// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/client", () => ({
  streamAssistantChat: vi.fn(),
  streamAssistantCommand: vi.fn(),
}));

import { streamAssistantChat, streamAssistantCommand } from "../api/client";
import { useAssistantTurn, OFFLINE_MESSAGE } from "./useAssistantTurn";
import type { ThreadItem } from "./threadItems";
import type { AssistantDashboardState } from "../types";

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

  it("a thrown fetch on chat appends OFFLINE_MESSAGE and sets offline", async () => {
    vi.mocked(streamAssistantChat).mockRejectedValue(new Error("network"));
    const { hook, append } = setup();
    await act(() => hook.result.current.sendChat("hi"));
    expect(append).toHaveBeenCalledWith({ kind: "notice", text: OFFLINE_MESSAGE });
    expect(hook.result.current.offline).toBe(true);
  });

  it("ignores a second call while a turn is in flight", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    vi.mocked(streamAssistantChat).mockImplementation(async (_p, { onEvent }) => {
      onEvent({ event: "token", data: { delta: "…" } });
      await gate;
    });
    const { hook, append } = setup();
    let first!: Promise<void>;
    act(() => { first = hook.result.current.sendChat("one"); });
    await waitFor(() => expect(hook.result.current.busy).toBe(true));
    const appendsAfterFirst = append.mock.calls.length;
    await act(() => hook.result.current.sendChat("two"));
    expect(vi.mocked(streamAssistantChat)).toHaveBeenCalledTimes(1);
    // The blocked call must leave no orphan user bubble in the thread.
    expect(append).toHaveBeenCalledTimes(appendsAfterFirst);
    await act(() => hook.result.current.runCommand("Widen radius", "update_filters"));
    expect(vi.mocked(streamAssistantCommand)).not.toHaveBeenCalled();
    expect(append).toHaveBeenCalledTimes(appendsAfterFirst);
    release();
    await act(() => first);
    expect(hook.result.current.busy).toBe(false);
  });
});

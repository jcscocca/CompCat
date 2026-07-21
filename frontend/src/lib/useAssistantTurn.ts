import { useCallback, useRef, useState } from "react";

import {
  streamAssistantChat,
  streamAssistantCommand,
  type AssistantCommandName,
} from "../api/client";
import { toApiMessages, type ThreadItem } from "./threadItems";
import type { AssistantDashboardState, AssistantStreamEvent } from "../types";

export const OFFLINE_MESSAGE =
  "Tabby can't reach the case files right now. Your data is unaffected — the rest of CompCat works.";
export const COMMAND_FAILURE_MESSAGE = "That command didn't go through. Try again in a moment.";

type Deps = {
  dashboardState: AssistantDashboardState;
  items: ThreadItem[];
  append: (item: ThreadItem) => void;
  onToolResult?: (data: { tool_name?: string; result?: unknown }) => void;
};

/** One reducer for both assistant streams (free-text chat and structured commands).
 * Lives in MapWorkspace so busy/draft/offline survive the panel unmounting. Only chat
 * outcomes drive `offline` — commands are the degraded-mode path and must keep working
 * while the LLM is down. */
export function useAssistantTurn({ dashboardState, items, append, onToolResult }: Deps) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [statusLine, setStatusLine] = useState("");
  const [toolActivity, setToolActivity] = useState<{ label: string }[]>([]);
  const [offline, setOffline] = useState(false);
  // Newest intent wins: a new turn aborts the one in flight. `turnSeq` tags each turn so a
  // superseded turn writes nothing (every state mutation is gated by `live()`) and its
  // `finally` can't clear the busy/draft state owned by the turn that replaced it.
  const turnSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const runTurn = useCallback(
    async (
      kind: "chat" | "command",
      start: (onEvent: (event: AssistantStreamEvent) => void, signal: AbortSignal) => Promise<void>,
    ) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const myTurn = ++turnSeq.current;
      const live = () => turnSeq.current === myTurn;
      let text = "";
      let errored = false;
      let errMessage = "";
      let errCode = "";
      // A settings-only command turn (only update_filters ran) already has a receipt for
      // its effect; suppress the duplicate summary bubble. Any other tool keeps the summary.
      // (The command route emits at most one tool event per turn today — the &&= accumulation
      // is defensive for a future multi-tool route.)
      let sawTool = false;
      let settingsOnly = true;
      setDraft("");
      setStatusLine("");
      setToolActivity([]);
      setBusy(true);
      try {
        await start((event) => {
          // A superseded turn's late events apply nothing.
          if (!live()) return;
          if (event.event === "tool") {
            const toolName = String(event.data.tool_name ?? "tool");
            sawTool = true;
            settingsOnly &&= toolName === "update_filters";
            setToolActivity((current) => [{ label: toolName }, ...current].slice(0, 4));
            onToolResult?.(event.data);
          }
          if (event.event === "status") {
            setStatusLine(String(event.data.label ?? ""));
          }
          if (event.event === "token") {
            text += event.data.delta ?? "";
            setStatusLine("");
            setDraft(text);
          }
          if (event.event === "replace") {
            text = String(event.data.text ?? "");
            setStatusLine("");
            setDraft(text);
          }
          if (event.event === "error") {
            if (!errored) {
              errMessage = String(event.data.message ?? "").trim();
              errCode = String(event.data.code ?? "");
            }
            errored = true;
          }
        }, controller.signal);
        if (!live()) return;
        if (!errored && text.trim() && !(kind === "command" && sawTool && settingsOnly)) {
          append({ kind: "tabby_text", text: text.trim() });
        }
        if (errored) {
          append({ kind: "notice", text: errMessage || OFFLINE_MESSAGE });
          if (kind === "chat" && errCode === "llm_unreachable") setOffline(true);
        } else if (kind === "chat") {
          setOffline(false);
        }
      } catch (error) {
        // A turn superseded mid-stream was aborted: it appends no notice and never
        // touches `offline`. Abort rejections vary by runtime, so check both the error
        // name and the controller's own aborted flag.
        if ((error as Error)?.name === "AbortError" || controller.signal.aborted || !live()) return;
        append({ kind: "notice", text: kind === "chat" ? OFFLINE_MESSAGE : COMMAND_FAILURE_MESSAGE });
        if (kind === "chat") setOffline(true);
      } finally {
        // Only the live turn clears shared busy/draft — a superseded turn must not wipe
        // the state owned by the turn that replaced it.
        if (live()) {
          setDraft("");
          setStatusLine("");
          setBusy(false);
        }
      }
    },
    [append, onToolResult],
  );

  // text === null re-sends the thread as-is (Retry after an error notice).
  const sendChat = useCallback(
    (text: string | null) => {
      const apiMessages = toApiMessages(items);
      if (text !== null) {
        apiMessages.push({ role: "user", content: text });
        append({ kind: "user_text", text });
      }
      return runTurn("chat", (onEvent, signal) =>
        streamAssistantChat({ messages: apiMessages, dashboard_state: dashboardState }, { onEvent }, signal),
      );
    },
    [items, append, dashboardState, runTurn],
  );

  const runCommand = useCallback(
    (label: string, command: AssistantCommandName, args: Record<string, unknown> = {}) => {
      append({ kind: "user_text", text: label });
      return runTurn("command", (onEvent, signal) =>
        streamAssistantCommand({ command, arguments: args }, { onEvent }, signal),
      );
    },
    [append, runTurn],
  );

  return { busy, draft, statusLine, toolActivity, offline, sendChat, runCommand };
}

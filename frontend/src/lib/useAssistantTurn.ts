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

type Deps = {
  dashboardState: AssistantDashboardState;
  items: ThreadItem[];
  append: (item: ThreadItem) => void;
  onToolResult?: (data: { tool_name?: string; result?: unknown }) => void;
};

/** One reducer for both assistant streams (free-text chat and structured commands).
 * Lives in MapWorkspace so busy/draft/offline survive the panel unmounting when
 * railView flips mid-turn. Only chat outcomes drive `offline` — commands are the
 * degraded-mode path and must keep working while the LLM is down. */
export function useAssistantTurn({ dashboardState, items, append, onToolResult }: Deps) {
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [statusLine, setStatusLine] = useState("");
  const [toolActivity, setToolActivity] = useState<{ label: string }[]>([]);
  const [offline, setOffline] = useState(false);
  // Synchronous re-entrancy gate: state updates lag within a tick.
  const inFlight = useRef(false);

  const runTurn = useCallback(
    async (kind: "chat" | "command", start: (onEvent: (event: AssistantStreamEvent) => void) => Promise<void>) => {
      if (inFlight.current) return;
      inFlight.current = true;
      let text = "";
      let errored = false;
      let errMessage = "";
      let errCode = "";
      setDraft("");
      setStatusLine("");
      setToolActivity([]);
      setBusy(true);
      try {
        await start((event) => {
          if (event.event === "tool") {
            const toolName = String(event.data.tool_name ?? "tool");
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
        });
        if (!errored && text.trim()) {
          append({ kind: "tabby_text", text: text.trim() });
        }
        if (errored) {
          append({ kind: "notice", text: errMessage || OFFLINE_MESSAGE });
          if (kind === "chat" && errCode === "llm_unreachable") setOffline(true);
        } else if (kind === "chat") {
          setOffline(false);
        }
      } catch {
        append({ kind: "notice", text: OFFLINE_MESSAGE });
        if (kind === "chat") setOffline(true);
      } finally {
        setDraft("");
        setStatusLine("");
        setBusy(false);
        inFlight.current = false;
      }
    },
    [append, onToolResult],
  );

  // text === null re-sends the thread as-is (Retry after an error notice).
  const sendChat = useCallback(
    (text: string | null) => {
      // Guard before the user_text append so an ignored call leaves no orphan
      // bubble; runTurn's own check stays as the backstop.
      if (inFlight.current) return Promise.resolve();
      const apiMessages = toApiMessages(items);
      if (text !== null) {
        apiMessages.push({ role: "user", content: text });
        append({ kind: "user_text", text });
      }
      return runTurn("chat", (onEvent) =>
        streamAssistantChat({ messages: apiMessages, dashboard_state: dashboardState }, { onEvent }),
      );
    },
    [items, append, dashboardState, runTurn],
  );

  const runCommand = useCallback(
    (label: string, command: AssistantCommandName, args: Record<string, unknown> = {}) => {
      if (inFlight.current) return Promise.resolve();
      append({ kind: "user_text", text: label });
      return runTurn("command", (onEvent) =>
        streamAssistantCommand({ command, arguments: args }, { onEvent }),
      );
    },
    [append, runTurn],
  );

  return { busy, draft, statusLine, toolActivity, offline, sendChat, runCommand };
}

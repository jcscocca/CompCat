// frontend/src/components/AssistantPanel.tsx
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import { streamAssistantChat } from "../api/client";
import { toApiMessages, type ThreadItem } from "../lib/threadItems";
import type { AssistantDashboardState } from "../types";
import { TabbyAvatar } from "./TabbyAvatar";

type Props = {
  dashboardState: AssistantDashboardState;
  items: ThreadItem[];
  onAppend: (item: ThreadItem) => void;
  // In-flight flag lives in the parent: bridge effects can flip the drawer to a legacy
  // view mid-stream, and a remounted panel must stay locked until the turn settles.
  busy: boolean;
  onBusyChange: (busy: boolean) => void;
  onToolResult?: (data: { tool_name?: string; result?: unknown }) => void;
  contextStrip?: ReactNode;
};

type ToolActivity = {
  label: string;
};

const OFFLINE_MESSAGE =
  "Tabby can't reach the case files right now. Your data is unaffected — the rest of CompCat works.";

const SUGGESTED_PROMPTS = [
  "What's near this pin?",
  "Compare my places",
  "What's on file around here?",
];

const GREETED_KEY = "wp-copper-greeted";

export function AssistantPanel({ dashboardState, items, onAppend, busy, onBusyChange, onToolResult, contextStrip }: Props) {
  const [draft, setDraft] = useState("");
  const [statusLine, setStatusLine] = useState("");
  const [input, setInput] = useState("");
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [greeted, setGreeted] = useState(() => localStorage.getItem(GREETED_KEY) === "1");

  // text === null re-sends the thread as-is (Retry after an error notice).
  async function sendTurn(text: string | null) {
    if (!greeted) {
      localStorage.setItem(GREETED_KEY, "1");
      setGreeted(true);
    }
    const apiMessages = toApiMessages(items);
    if (text !== null) {
      apiMessages.push({ role: "user", content: text });
      onAppend({ kind: "user_text", text });
    }
    let assistantText = "";
    let errored = false;
    let turnError = "";
    setDraft("");
    setStatusLine("");
    setToolActivity([]);
    onBusyChange(true);

    try {
      await streamAssistantChat(
        { messages: apiMessages, dashboard_state: dashboardState },
        {
          onEvent: (event) => {
            if (event.event === "tool") {
              const toolName = String(event.data.tool_name ?? "tool");
              setToolActivity((current) => [{ label: toolName }, ...current].slice(0, 4));
              onToolResult?.(event.data);
            }
            if (event.event === "status") {
              setStatusLine(String(event.data.label ?? ""));
            }
            if (event.event === "token") {
              assistantText += event.data.delta ?? "";
              setStatusLine("");
              setDraft(assistantText);
            }
            if (event.event === "replace") {
              assistantText = String(event.data.text ?? "");
              setStatusLine("");
              setDraft(assistantText);
            }
            if (event.event === "error") {
              if (!errored) turnError = String(event.data.message ?? "").trim();
              errored = true;
            }
          },
        },
      );
      // Don't commit a partial/empty answer when the turn errored — record a notice
      // instead, so Retry re-sends the same (still-unanswered) last turn.
      if (!errored && assistantText.trim()) {
        onAppend({ kind: "tabby_text", text: assistantText.trim() });
      }
      setDraft("");
      if (errored) onAppend({ kind: "notice", text: turnError || OFFLINE_MESSAGE });
    } catch {
      setDraft("");
      onAppend({ kind: "notice", text: OFFLINE_MESSAGE });
    } finally {
      setStatusLine("");
      onBusyChange(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || busy) return;
    setInput("");
    void sendTurn(content);
  }

  const conversationEmpty = items.every((item) => item.kind === "receipt");
  // Fold the in-flight draft into the same list/keys the committed items use, so the
  // bubble that shows streaming text is the same DOM node the final commit updates in
  // place (rather than an unmount+remount when the turn settles).
  const displayItems: ThreadItem[] = draft ? [...items, { kind: "tabby_text", text: draft }] : items;

  return (
    <aside className="mc-dock mc-rail" aria-label="Tabby">
      <div className="mc-dock-head">
        <h3>
          <TabbyAvatar variant="mark" size={20} className={greeted ? undefined : "mc-tabby-pulse"} />
          Tabby
          <span className="mc-dock-role">case desk · analyst</span>
        </h3>
        <span className="mc-dock-status">{busy ? "Checking the files…" : "At the desk"}</span>
      </div>

      <div className="mc-dock-log" aria-live="polite">
        {displayItems.map((item, index) => {
          if (item.kind === "user_text") {
            return <div key={index} className="mc-dock-msg is-user">{item.text}</div>;
          }
          if (item.kind === "tabby_text") {
            return (
              <div key={index} className="mc-dock-msg is-assistant">
                <ReactMarkdown>{item.text}</ReactMarkdown>
              </div>
            );
          }
          if (item.kind === "receipt") {
            return <div key={index} className="mc-dock-msg is-receipt">{item.text}</div>;
          }
          return (
            <div key={index} className="mc-dock-msg is-notice">
              <p>{item.text}</p>
              {items.slice(index + 1).every((later) => later.kind === "receipt") ? (
                <button type="button" className="mc-chip" onClick={() => void sendTurn(null)} disabled={busy}>
                  Retry
                </button>
              ) : null}
            </div>
          );
        })}
        {!draft && statusLine ? (
          <div className="mc-dock-msg is-assistant mc-dock-statusline">{statusLine}</div>
        ) : null}
        {conversationEmpty && !draft ? (
          <div className="mc-dock-empty">
            <TabbyAvatar variant="bust" size={72} />
            <p>Tabby, case desk. Point me at a place and I'll pull the reports near it.</p>
            <div className="mc-dock-chips">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button key={prompt} type="button" className="mc-chip" disabled={busy}
                  onClick={() => void sendTurn(prompt)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      {toolActivity.length ? (
        <ul className="mc-dock-tools" aria-label="Tool activity">
          {toolActivity.map((item, index) => (
            <li key={`${item.label}-${index}`}>{item.label}</li>
          ))}
        </ul>
      ) : null}

      {contextStrip}

      <form className="mc-dock-form" onSubmit={handleSubmit}>
        <label className="mc-sr" htmlFor="assistant-message">Analyst message</label>
        <textarea
          id="assistant-message"
          value={input}
          rows={2}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={busy || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}

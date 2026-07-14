import { useState } from "react";
import ReactMarkdown from "react-markdown";

import { streamAssistantChat } from "../api/client";
import type { AssistantDashboardState, AssistantMessage } from "../types";
import { TabbyAvatar } from "./TabbyAvatar";

type Props = {
  dashboardState: AssistantDashboardState;
  onToolResult?: (data: { tool_name?: string; result?: unknown }) => void;
};

type ToolActivity = {
  label: string;
};

const OFFLINE_MESSAGE =
  "Copper can't reach the case files right now. Your data is unaffected — the rest of Waypoint works.";

const SUGGESTED_PROMPTS = [
  "What's near this pin?",
  "Compare my places",
  "What's on file around here?",
];

const GREETED_KEY = "wp-copper-greeted";

export function AssistantPanel({ dashboardState, onToolResult }: Props) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [statusLine, setStatusLine] = useState("");
  const [input, setInput] = useState("");
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [errorMessage, setErrorMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [greeted, setGreeted] = useState(() => localStorage.getItem(GREETED_KEY) === "1");

  async function sendTurn(turnMessages: AssistantMessage[]) {
    if (!greeted) {
      localStorage.setItem(GREETED_KEY, "1");
      setGreeted(true);
    }
    let assistantText = "";
    let errored = false;
    let turnError = "";
    setMessages(turnMessages);
    setDraft("");
    setStatusLine("");
    setErrorMessage("");
    setToolActivity([]);
    setSending(true);

    try {
      await streamAssistantChat(
        { messages: turnMessages, dashboard_state: dashboardState },
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
      // Don't commit a partial/empty answer when the turn errored — surface the degraded
      // state instead, so a "Retry" re-sends the same (still-unanswered) last turn.
      if (!errored && assistantText.trim()) {
        setMessages([...turnMessages, { role: "assistant", content: assistantText.trim() }]);
      }
      setDraft("");
      if (errored) setErrorMessage(turnError || OFFLINE_MESSAGE);
    } catch {
      setDraft("");
      setErrorMessage(OFFLINE_MESSAGE);
    } finally {
      setStatusLine("");
      setSending(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    void sendTurn([...messages, { role: "user", content }]);
  }

  function handleRetry() {
    // The last message is the user turn that got no answer; re-send the conversation as-is.
    if (sending || messages.length === 0) return;
    void sendTurn(messages);
  }

  return (
    <aside className="mc-dock" aria-label="Analyst">
      <div className="mc-dock-head">
        <h3>
          <TabbyAvatar variant="mark" size={20} className={greeted ? undefined : "mc-tabby-pulse"} />
          Copper
          <span className="mc-dock-role">case desk · analyst</span>
        </h3>
        <span className="mc-dock-status">{sending ? "Checking the files…" : "At the desk"}</span>
        <button
          type="button"
          className="mc-dock-collapse"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand analyst" : "Collapse analyst"}
          onClick={() => setCollapsed((c) => !c)}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d={collapsed ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
        </button>
      </div>

      {collapsed ? null : (
        <>
          <div className="mc-dock-log" aria-live="polite">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`mc-dock-msg is-${message.role}`}>
                {message.role === "assistant" ? (
                  <ReactMarkdown>{message.content}</ReactMarkdown>
                ) : (
                  message.content
                )}
              </div>
            ))}
            {draft ? (
              <div className="mc-dock-msg is-assistant">
                <ReactMarkdown>{draft}</ReactMarkdown>
              </div>
            ) : null}
            {!draft && statusLine ? (
              <div className="mc-dock-msg is-assistant mc-dock-statusline">{statusLine}</div>
            ) : null}
            {messages.length === 0 && !draft ? (
              <div className="mc-dock-empty">
                <TabbyAvatar variant="bust" size={72} />
                <p>Copper, case desk. Point me at a place and I'll pull the reports near it.</p>
                <div className="mc-dock-chips">
                  {SUGGESTED_PROMPTS.map((prompt) => (
                    <button key={prompt} type="button" className="mc-chip" disabled={sending}
                      onClick={() => void sendTurn([...messages, { role: "user", content: prompt }])}>
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

          {errorMessage ? (
            <div className="mc-dock-error" role="status">
              <p>{errorMessage}</p>
              <button type="button" className="mc-chip" onClick={handleRetry} disabled={sending}>
                Retry
              </button>
            </div>
          ) : null}

          <form className="mc-dock-form" onSubmit={handleSubmit}>
            <label className="mc-sr" htmlFor="assistant-message">Analyst message</label>
            <textarea
              id="assistant-message"
              value={input}
              rows={2}
              onChange={(event) => setInput(event.target.value)}
            />
            <button type="submit" disabled={sending || !input.trim()}>
              Send
            </button>
          </form>
        </>
      )}
    </aside>
  );
}

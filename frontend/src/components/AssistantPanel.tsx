import { useState } from "react";
import ReactMarkdown from "react-markdown";

import { streamAssistantChat } from "../api/client";
import type { AssistantDashboardState, AssistantMessage } from "../types";

type Props = {
  dashboardState: AssistantDashboardState;
  onToolResult?: (data: { tool_name?: string; result?: unknown }) => void;
};

type ToolActivity = {
  label: string;
};

const OFFLINE_MESSAGE =
  "The analyst is offline right now. Your data is unaffected — the rest of Waypoint works.";

export function AssistantPanel({ dashboardState, onToolResult }: Props) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [input, setInput] = useState("");
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [offline, setOffline] = useState(false);
  const [sending, setSending] = useState(false);

  async function sendTurn(turnMessages: AssistantMessage[]) {
    let assistantText = "";
    let errored = false;
    setMessages(turnMessages);
    setDraft("");
    setOffline(false);
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
            if (event.event === "token") {
              assistantText += event.data.delta ?? "";
              setDraft(assistantText);
            }
            if (event.event === "error") {
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
      if (errored) setOffline(true);
    } catch {
      setDraft("");
      setOffline(true);
    } finally {
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
    <aside className="mc-assistant" aria-label="Analyst">
      <div className="mc-assistant-head">
        <h3>Analyst</h3>
        <span>{sending ? "Working" : "Ready"}</span>
      </div>

      <div className="mc-assistant-log" aria-live="polite">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`mc-assistant-msg is-${message.role}`}>
            {message.role === "assistant" ? (
              <ReactMarkdown>{message.content}</ReactMarkdown>
            ) : (
              message.content
            )}
          </div>
        ))}
        {draft ? <div className="mc-assistant-msg is-assistant">{draft}</div> : null}
        {messages.length === 0 && !draft ? <p className="mc-assistant-empty">No messages</p> : null}
      </div>

      {toolActivity.length ? (
        <ul className="mc-assistant-tools" aria-label="Tool activity">
          {toolActivity.map((item, index) => (
            <li key={`${item.label}-${index}`}>{item.label}</li>
          ))}
        </ul>
      ) : null}

      {offline ? (
        <div className="mc-assistant-error" role="status">
          <p>{OFFLINE_MESSAGE}</p>
          <button type="button" className="mc-chip" onClick={handleRetry} disabled={sending}>
            Retry
          </button>
        </div>
      ) : null}

      <form className="mc-assistant-form" onSubmit={handleSubmit}>
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
    </aside>
  );
}

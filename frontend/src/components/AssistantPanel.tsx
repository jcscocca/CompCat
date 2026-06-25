import { useState } from "react";

import { streamAssistantChat } from "../api/client";
import type { AssistantDashboardState, AssistantMessage } from "../types";

type Props = {
  dashboardState: AssistantDashboardState;
};

type ToolActivity = {
  label: string;
};

export function AssistantPanel({ dashboardState }: Props) {
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [input, setInput] = useState("");
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || sending) return;

    const nextMessages: AssistantMessage[] = [...messages, { role: "user", content }];
    let assistantText = "";
    setMessages(nextMessages);
    setInput("");
    setDraft("");
    setError("");
    setSending(true);

    try {
      await streamAssistantChat(
        { messages: nextMessages, dashboard_state: dashboardState },
        {
          onEvent: (event) => {
            if (event.event === "tool") {
              const toolName = String(event.data.tool_name ?? "tool");
              setToolActivity((current) => [{ label: toolName }, ...current].slice(0, 4));
            }
            if (event.event === "token") {
              assistantText += event.data.delta ?? "";
              setDraft(assistantText);
            }
            if (event.event === "error") {
              setError(event.data.message || "Assistant unavailable.");
            }
          },
        },
      );
      if (assistantText.trim()) {
        setMessages([...nextMessages, { role: "assistant", content: assistantText.trim() }]);
      }
      setDraft("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Assistant unavailable.");
    } finally {
      setSending(false);
    }
  }

  return (
    <aside className="mc-assistant" aria-label="Analyst">
      <div className="mc-assistant-head">
        <h3>Analyst</h3>
        <span>{sending ? "Working" : "Ready"}</span>
      </div>

      <div className="mc-assistant-log" aria-live="polite">
        {messages.map((message, index) => (
          <p key={`${message.role}-${index}`} className={`mc-assistant-msg is-${message.role}`}>
            {message.content}
          </p>
        ))}
        {draft ? <p className="mc-assistant-msg is-assistant">{draft}</p> : null}
        {messages.length === 0 && !draft ? <p className="mc-assistant-empty">No messages</p> : null}
      </div>

      {toolActivity.length ? (
        <ul className="mc-assistant-tools" aria-label="Tool activity">
          {toolActivity.map((item, index) => (
            <li key={`${item.label}-${index}`}>{item.label}</li>
          ))}
        </ul>
      ) : null}

      {error ? <p className="mc-assistant-error" role="status">{error}</p> : null}

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


// frontend/src/components/AssistantPanel.tsx
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import type { AssistantCommandName } from "../api/client";
import type { ThreadItem } from "../lib/threadItems";
import { TabbyAvatar } from "./TabbyAvatar";

type SuggestedAction = { label: string; command?: AssistantCommandName };

type Props = {
  items: ThreadItem[];
  busy: boolean;
  draft: string;
  statusLine: string;
  toolActivity: { label: string }[];
  offline: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
  onRunCommand: (label: string, command: AssistantCommandName) => void;
  contextStrip?: ReactNode;
};

const SUGGESTED_ACTIONS: SuggestedAction[] = [
  { label: "What's near this pin?", command: "analyze_places" },
  { label: "Compare my places", command: "compare_places" },
  { label: "What's on file around here?" }, // free-text — needs the LLM
];

const OFFLINE_COMPOSER_HINT = "Tabby can't reach the case files — your filters and Retry still work.";

const GREETED_KEY = "wp-copper-greeted";

export function AssistantPanel({
  items,
  busy,
  draft,
  statusLine,
  toolActivity,
  offline,
  onSend,
  onRetry,
  onRunCommand,
  contextStrip,
}: Props) {
  const [input, setInput] = useState("");
  const [greeted, setGreeted] = useState(() => localStorage.getItem(GREETED_KEY) === "1");

  function markGreeted() {
    if (!greeted) {
      localStorage.setItem(GREETED_KEY, "1");
      setGreeted(true);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || busy || offline) return;
    markGreeted();
    setInput("");
    onSend(content);
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
                <button type="button" className="mc-chip" onClick={onRetry} disabled={busy}>
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
              {SUGGESTED_ACTIONS.map((action) => {
                const command = action.command;
                return command ? (
                  <button key={action.label} type="button" className="mc-chip" disabled={busy}
                    onClick={() => { markGreeted(); onRunCommand(action.label, command); }}>
                    {action.label}
                  </button>
                ) : (
                  <button key={action.label} type="button" className="mc-chip" disabled={busy || offline}
                    onClick={() => { markGreeted(); onSend(action.label); }}>
                    {action.label}
                  </button>
                );
              })}
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

      {offline ? <p className="mc-rail-offline">{OFFLINE_COMPOSER_HINT}</p> : null}

      <form className="mc-dock-form" onSubmit={handleSubmit}>
        <label className="mc-sr" htmlFor="assistant-message">Analyst message</label>
        <textarea
          id="assistant-message"
          value={input}
          rows={2}
          disabled={offline}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit" disabled={busy || offline || !input.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}

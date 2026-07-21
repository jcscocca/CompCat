// frontend/src/components/AssistantPanel.tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import type { AssistantCommandName } from "../api/client";
import type { FollowupChip } from "../lib/followupChips";
import type { ThreadItem } from "../lib/threadItems";
import type { AnalysisCardData } from "../types";
import { AnalysisCard } from "./AnalysisCard";
import { TabbyAvatar } from "./TabbyAvatar";

type OnboardingAction = "search" | "add-pin" | "manual";

type SuggestedAction = { label: string; command?: AssistantCommandName; action?: OnboardingAction };

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
  /** False on a truly fresh session (no saved places, no ad-hoc list entries) — drives
   * which empty-state copy + chips render. */
  hasPlaces: boolean;
  onAction: (action: OnboardingAction) => void;
  followupChips: FollowupChip[];
  onFollowupChip: (chip: FollowupChip) => void;
  /** Keyed by card object identity, not thread index — the thread cap drops oldest items
   * and shifts indices, but card references survive the slice. */
  expandedCard: AnalysisCardData | null;
  /** The card that still matches the live scope; older frozen cards remain readable but
   * are labeled as previous analysis instead of looking current. */
  currentCard?: AnalysisCardData | null;
  onCardExpandChange: (card: AnalysisCardData, expanded: boolean) => void;
  /** A badge-tap focus request. Wrapped in a fresh object per tap so re-focusing the SAME
   * card (object identity unchanged) still re-fires the scroll effect below. */
  focusCard?: { card: AnalysisCardData } | null;
  exportHrefBase: string;
  contextStrip?: ReactNode;
  /** Desktop-only pane controls live with the pane identity instead of in a separate
   * size-mode strip. Mobile continues to use the bottom-sheet grabber. */
  paneActions?: ReactNode;
  /** Dashboard error string (run/rename/save/export failures) announced on the rail —
   * the retired Compare panel used to be the visible home for these. */
  errorLine?: string;
};

const SUGGESTED_ACTIONS: SuggestedAction[] = [
  { label: "What's near this pin?", command: "analyze_places" },
  { label: "Compare my places", command: "compare_places" },
  { label: "What's on file around here?" }, // free-text — needs the LLM
];

// Fresh-session onboarding: no places yet, so lead with the three ways to point Tabby at
// a place instead of the has-places prompt chips.
const ONBOARDING_ACTIONS: SuggestedAction[] = [
  { label: "Search an address", action: "search" },
  { label: "Drop a pin", action: "add-pin" },
  { label: "Add places manually", action: "manual" },
];

const OFFLINE_COMPOSER_HINT = "Tabby can't reach the case files — chips and filters still work.";

const GREETED_KEY = "compcat.tabby.greeted";

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
  hasPlaces,
  onAction,
  followupChips,
  onFollowupChip,
  expandedCard,
  currentCard,
  onCardExpandChange,
  focusCard,
  exportHrefBase,
  contextStrip,
  paneActions,
  errorLine,
}: Props) {
  const [input, setInput] = useState("");
  const [greeted, setGreeted] = useState(() => localStorage.getItem(GREETED_KEY) === "1");
  // Card wrapper elements keyed by their index in displayItems, for scroll-to-card.
  const cardRefs = useRef(new Map<number, HTMLDivElement>());

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

  useEffect(() => {
    if (!focusCard) return;
    // Newest match wins: scan from the end so a later duplicate of the same card resolves
    // to its latest wrapper. focusCard is a fresh object per tap, so this re-fires even
    // when the target card object is unchanged.
    for (let i = displayItems.length - 1; i >= 0; i--) {
      const item = displayItems[i];
      if (item.kind === "analysis_card" && item.card === focusCard.card) {
        cardRefs.current.get(i)?.scrollIntoView({ behavior: "smooth", block: "center" });
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCard]);

  return (
    <aside className="mc-dock mc-rail" aria-label="Tabby">
      <div className="mc-dock-head">
        <h3>
          <TabbyAvatar variant="mark" size={20} className={greeted ? undefined : "mc-tabby-pulse"} />
          Tabby
          <span className="mc-dock-role">case desk · analyst</span>
        </h3>
        <span className="mc-dock-status">{busy ? "Checking the files…" : "At the desk"}</span>
        {paneActions}
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
          if (item.kind === "notice") {
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
          }
          if (item.kind === "analysis_card") {
            return (
              <div
                key={index}
                data-card-index={index}
                ref={(el) => {
                  if (el) cardRefs.current.set(index, el);
                  else cardRefs.current.delete(index);
                }}
              >
                <AnalysisCard
                  card={item.card}
                  expanded={expandedCard === item.card}
                  historical={currentCard !== undefined && currentCard !== item.card}
                  onExpandChange={(next) => onCardExpandChange(item.card, next)}
                  exportHrefBase={exportHrefBase}
                />
              </div>
            );
          }
          return null;
        })}
        {!draft && statusLine ? (
          <div className="mc-dock-msg is-assistant mc-dock-statusline">{statusLine}</div>
        ) : null}
        {conversationEmpty && !draft ? (
          <div className="mc-dock-empty">
            <TabbyAvatar variant="bust" size={72} />
            <p>
              {hasPlaces
                ? "Tabby, case desk. Point me at a place and I'll pull the reports near it."
                : "Tabby, case desk. Point me at a place — search an address, drop a pin, or add one by hand — and I'll pull the reports near it."}
            </p>
            <div className="mc-dock-chips">
              {(hasPlaces ? SUGGESTED_ACTIONS : ONBOARDING_ACTIONS).map((suggestion) => {
                if (suggestion.action) {
                  const onboardingAction = suggestion.action;
                  return (
                    <button key={suggestion.label} type="button" className="mc-chip" disabled={busy}
                      onClick={() => { markGreeted(); onAction(onboardingAction); }}>
                      {suggestion.label}
                    </button>
                  );
                }
                const command = suggestion.command;
                return command ? (
                  <button key={suggestion.label} type="button" className="mc-chip" disabled={busy}
                    onClick={() => { markGreeted(); onRunCommand(suggestion.label, command); }}>
                    {suggestion.label}
                  </button>
                ) : (
                  <button key={suggestion.label} type="button" className="mc-chip" disabled={busy || offline}
                    onClick={() => { markGreeted(); onSend(suggestion.label); }}>
                    {suggestion.label}
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

      {followupChips.length > 0 && !busy ? (
        <div className="mc-followups">
          {followupChips.map((chip) => (
            <button key={chip.label} type="button" className="mc-chip" onClick={() => onFollowupChip(chip)}>
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      {errorLine ? <p className="mc-inline-error" role="alert">{errorLine}</p> : null}

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

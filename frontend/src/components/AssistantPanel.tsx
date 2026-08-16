// frontend/src/components/AssistantPanel.tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";

import type { AssistantCommandName } from "../api/client";
import type { FollowupChip } from "../lib/followupChips";
import type { ThreadItem } from "../lib/threadItems";
import type { AnalysisCardData, AnalysisSettings } from "../types";
import { AnalysisCard } from "./AnalysisCard";
import { TabbyAvatar } from "./TabbyAvatar";

type OnboardingAction = "search" | "add-pin" | "manual";

type SuggestedAction = { label: string; command?: AssistantCommandName; action?: OnboardingAction };

type Props = {
  items: ThreadItem[];
  busy: boolean;
  draft: string;
  statusLine: string;
  offline: boolean;
  onSend: (text: string) => void;
  onRetry: () => void;
  onRunCommand: (label: string, command: AssistantCommandName) => void;
  showDataBusy?: boolean;
  coverageAdjustment?: string | null;
  onUseAvailableDates?: () => void;
  workspaceAnalysis?: AnalysisSettings;
  onRerunReport?: () => void;
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
  /** Applies the previous shared context from a deterministic assistant-change receipt. */
  onUndoSettings?: (settings: Partial<AnalysisSettings>) => void;
  /** Desktop-only pane controls live with the pane identity instead of in a separate
   * size-mode strip. Mobile continues to use the bottom-sheet grabber. */
  paneActions?: ReactNode;
  /** Transient map-owned data inspector; never appended to the assistant thread. */
  areaInspector?: ReactNode;
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

const REPORT_CHAT_PROMPTS = [
  "What stands out?",
  "Explain the timeline",
  "Explain the categories",
];

const OFFLINE_COMPOSER_HINT = "Tabby can't reach the case files — chips and filters still work.";

const GREETED_KEY = "compcat.tabby.greeted";

/** How far off the bottom still counts as "reading the newest entry". */
const STICK_TO_BOTTOM_SLACK_PX = 48;

export function AssistantPanel({
  items,
  busy,
  draft,
  statusLine,
  offline,
  onSend,
  onRetry,
  onRunCommand,
  showDataBusy = false,
  coverageAdjustment,
  onUseAvailableDates,
  workspaceAnalysis,
  onRerunReport,
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
  onUndoSettings,
  paneActions,
  areaInspector,
  errorLine,
}: Props) {
  const [input, setInput] = useState("");
  const [greeted, setGreeted] = useState(() => localStorage.getItem(GREETED_KEY) === "1");
  const [usedUndoIds, setUsedUndoIds] = useState<Set<string>>(new Set());
  const areaInspectorRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Card wrapper elements keyed by their index in displayItems, for scroll-to-card.
  const cardRefs = useRef(new Map<number, HTMLDivElement>());
  const logRef = useRef<HTMLDivElement>(null);
  // Stick to the bottom only while the reader is already there — scrolling up to re-read an
  // earlier answer must not be yanked back by the next streamed token.
  const stickToBottomRef = useRef(true);

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
  const newestDisplayItem = displayItems.at(-1);
  const hasAreaInspector = Boolean(areaInspector);
  const resultFocused = expandedCard !== null || hasAreaInspector;
  const reportReady = currentCard != null;
  const staleReportCard = currentCard === null && !resultFocused
    ? [...displayItems].reverse().find((item) => item.kind === "analysis_card")?.card ?? null
    : null;
  const hasVisibleConversation = displayItems.some((item) => item.kind !== "analysis_card")
    || Boolean(statusLine);
  const showConversationStart = conversationEmpty && !draft && !resultFocused;

  useEffect(() => {
    if (reportReady) composerRef.current?.focus({ preventScroll: true });
  }, [currentCard, reportReady]);

  useEffect(() => {
    if (hasAreaInspector) areaInspectorRef.current?.scrollTo?.({ top: 0 });
  }, [hasAreaInspector]);

  // Follow the newest entry and the streaming draft. Runs on every commit rather than on a
  // length change alone: a streamed answer grows the same node in place. Analysis cards are
  // documents, not chat bubbles; their dedicated focus effect below owns the landing position
  // so a tall report opens at its heading instead of at its final chart.
  useEffect(() => {
    const log = logRef.current;
    if (!log || !stickToBottomRef.current || newestDisplayItem?.kind === "analysis_card") return;
    log.scrollTop = log.scrollHeight;
  }, [displayItems.length, draft, newestDisplayItem?.kind, statusLine]);

  useEffect(() => {
    if (!focusCard) return;
    // Newest match wins: scan from the end so a later duplicate of the same card resolves
    // to its latest wrapper. focusCard is a fresh object per tap, so this re-fires even
    // when the target card object is unchanged.
    for (let i = displayItems.length - 1; i >= 0; i--) {
      const item = displayItems[i];
      if (item.kind === "analysis_card" && item.card === focusCard.card) {
        cardRefs.current.get(i)?.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusCard]);

  return (
    <div className={`mc-dock mc-rail${resultFocused ? " is-result-focused" : ""}${reportReady ? " has-current-report" : ""}${showConversationStart ? " is-starting" : ""}`}>
      <div className="mc-dock-head">
        <div className="mc-tabby-identity">
          <span className={`mc-tabby-mark${greeted ? "" : " mc-tabby-pulse"}${offline ? " is-offline" : ""}`}>
            <TabbyAvatar variant="mark" size={30} />
            <span className="mc-tabby-presence" aria-hidden="true" />
          </span>
          <span className="mc-tabby-title">
            <h2>Tabby</h2>
            <span className="mc-dock-role">CompCat analyst</span>
          </span>
        </div>
        <span className={`mc-dock-status${offline ? " is-offline" : busy ? " is-busy" : ""}`}>
          <span aria-hidden="true" />
          {offline ? "Offline" : busy ? "On the case" : "At the desk"}
        </span>
        {paneActions}
      </div>

      {showConversationStart ? (
        <div className="mc-dock-start">
          <div className="mc-tabby-welcome">
            <div className="mc-tabby-portrait">
              <TabbyAvatar variant="bust" size={78} />
            </div>
            <div className="mc-tabby-intro">
              <span className="mc-tabby-kicker">Case desk</span>
              <h3>{hasPlaces ? "What should we look into?" : "Let’s start with a place"}</h3>
              <p>
                {hasPlaces
                  ? "Run a report or ask about the places in this analysis."
                  : "Point me at a place: search, drop a pin, or add one manually."}
              </p>
            </div>
          </div>
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

      {staleReportCard ? (
        <div className="mc-stale-report-bar">
          <span className="mc-stale-report-copy">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 3h9l3 3v15H6z" />
              <path d="M14 3v4h4M9 12h6M9 16h6" />
            </svg>
            <span>
              <strong>Previous report</strong>
              <small>Kept for reference</small>
            </span>
          </span>
          <button type="button" onClick={() => onCardExpandChange(staleReportCard, true)}>
            View
          </button>
        </div>
      ) : null}

      {areaInspector ? (
        <div ref={areaInspectorRef} className="mc-area-inspector">{areaInspector}</div>
      ) : !staleReportCard || hasVisibleConversation ? <div
        className="mc-dock-log"
        aria-live="polite"
        ref={logRef}
        onScroll={(event) => {
          const log = event.currentTarget;
          stickToBottomRef.current =
            log.scrollHeight - log.scrollTop - log.clientHeight <= STICK_TO_BOTTOM_SLACK_PX;
        }}
      >
        {displayItems.map((item, index) => {
          if (staleReportCard && item.kind === "analysis_card") return null;
          if (item.kind === "user_text") {
            return <div key={index} className="mc-dock-msg is-user">{item.text}</div>;
          }
          if (item.kind === "tabby_text") {
            // The streaming draft is the synthesized last item while `draft` is truthy. Hide
            // it from the aria-live region so a screen reader isn't re-read the growing message
            // on every token; when the turn settles the same node loses aria-hidden and the
            // final answer is announced once.
            const isStreamingDraft = !!draft && index === displayItems.length - 1;
            return (
              <div
                key={index}
                className="mc-dock-msg is-assistant"
                aria-hidden={isStreamingDraft || undefined}
              >
                <ReactMarkdown>{item.text}</ReactMarkdown>
              </div>
            );
          }
          if (item.kind === "receipt") {
            const undoUsed = item.undo ? usedUndoIds.has(item.undo.id) : false;
            return (
              <div key={index} className="mc-dock-msg is-receipt">
                <span>{item.text}</span>
                {item.undo && onUndoSettings && !undoUsed ? (
                  <button
                    type="button"
                    onClick={() => {
                      onUndoSettings(item.undo!.settings);
                      setUsedUndoIds((current) => new Set([...current, item.undo!.id]));
                    }}
                  >
                    Undo
                  </button>
                ) : undoUsed ? <small>Restored</small> : null}
              </div>
            );
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
                  workspaceAnalysis={workspaceAnalysis}
                  onRerun={onRerunReport}
                />
              </div>
            );
          }
          return null;
        })}
        {!draft && statusLine ? (
          <div className="mc-dock-msg is-assistant mc-dock-statusline">{statusLine}</div>
        ) : null}
      </div> : null}

      {!resultFocused && followupChips.length > 0 && !busy ? (
        <div className="mc-followups">
          {followupChips.map((chip) => (
            <button key={chip.label} type="button" className="mc-chip" onClick={() => onFollowupChip(chip)}>
              {chip.label}
            </button>
          ))}
        </div>
      ) : null}

      {errorLine ? <p className="mc-inline-error" role="alert">{errorLine}</p> : null}
      {coverageAdjustment && onUseAvailableDates ? (
        <div className="mc-report-coverage" role="status">
          <span>Available records begin {coverageAdjustment}.</span>
          <button type="button" className="mc-chip" onClick={onUseAvailableDates} disabled={showDataBusy}>
            Use available dates
          </button>
        </div>
      ) : null}

      {!resultFocused ? (
        <div className={`mc-context-composer${reportReady ? " is-report-chat" : ""}`}>
          <div className="mc-context-body">{contextStrip}</div>
          <div className="mc-action-dock">
            {offline ? <p className="mc-rail-offline">{OFFLINE_COMPOSER_HINT}</p> : null}
            {reportReady ? (
              <div className="mc-report-chat-intro">
                <span className="mc-report-chat-kicker">Report ready</span>
                <strong>Ask Tabby about this report</strong>
                <small>Explore the results, request an explanation, or decide what to examine next.</small>
              </div>
            ) : null}
            {reportReady && !busy ? (
              <div className="mc-report-chat-prompts" aria-label="Questions to ask Tabby about this report">
                {REPORT_CHAT_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="mc-report-chat-prompt"
                    disabled={offline}
                    onClick={() => {
                      markGreeted();
                      onSend(prompt);
                    }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
            <form className="mc-dock-form" onSubmit={handleSubmit}>
              <label className="mc-sr" htmlFor="assistant-message">Analyst message</label>
              <textarea
                ref={composerRef}
                id="assistant-message"
                value={input}
                rows={reportReady ? 3 : 1}
                disabled={offline}
                placeholder={offline ? "Tabby is offline" : reportReady ? "Ask Tabby about this report…" : "Ask Tabby…"}
                onChange={(event) => setInput(event.target.value)}
              />
              <div className="mc-dock-form-actions">
                <button type="submit" disabled={busy || offline || !input.trim()}>
                  Send
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}

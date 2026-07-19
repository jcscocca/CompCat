# Tabby-central redesign — design spec

Date: 2026-07-19
Status: approved direction; amended after external (Codex) design review

## Goal

Make Tabby the app's front door and guide while the map stays the visual center.
Users explore by asking or telling Tabby (free text) or by tapping Tabby's
suggestion chips; manual controls remain as a compact secondary path. The
product invariant is unchanged: CompCat reports reported-incident context, never
safety scores or safe/unsafe rankings.

## Decisions (validated interactively)

1. **Archetype** — "Tabby drives the cockpit": map canvas central, Tabby's
   input always visible as the primary way in.
2. **Tabby's role** — execute **and** suggest: natural-language commands change
   filters/selection/analyses, and Tabby proactively offers next moves as chips.
3. **Chat surface** — desktop: persistent side rail (evolves today's drawer);
   mobile: bottom sheet with bar-only / half / full snap heights (evolves
   today's sheet). No collapsible dock; the rail/sheet IS Tabby.
4. **Results** — analyses render as rich cards inline in the conversation
   thread, built only from structured tool results (never parsed from prose),
   each showing its frozen run settings and a run-scoped export action.
   Cards have two sizes: **compact** (default — verdict lines, trend
   sparkline, category mini-bars) and **expanded** (the full graph set:
   trend chart, category breakdown, baseline detail, incident rows, methods).
   Expanding widens the rail via the existing drawer width presets on desktop
   and raises the sheet to full on mobile; closing restores the normal width.
   Every graph in today's Compare tab lands in the expanded card — none are
   dropped. Compare/Export tabs dissolve (staged; see Migration).
5. **Map badges (v1)** — neutral **presence** badges on analyzed pins
   ("● analyzed — tap for context"); no verdict text, arrows, or evaluative
   color. Tapping a badge scrolls the thread to that place's latest card
   (mobile: raises the sheet to half). Graduating badges to verdict text is a
   possible later step, gated on a map legend naming metric/layer/window and a
   comprehension check — not in this spec's scope.
6. **Filters** — a one-line **context strip** above the input always shows the
   active `AnalysisSettings` ("90 d · 250 m · all offenses · police layer",
   tap to edit); each result card shows the frozen settings it ran with.
7. **Proactivity** — exactly three moments, all deterministic templates + chips
   (no LLM call): first-visit onboarding; place added ("pull reports near
   this?"); analysis completed (refinement chips extending `suggest_followups`).
8. **Degraded mode** — when the LLM endpoint is unreachable, only free-text
   input disables (with a short notice); chips, badges, cards, context strip,
   and exports keep working through the non-LLM command path.

## Architecture

### Frontend

- `MapWorkspace` remains the shell. The `BottomSheet` drawer surface becomes
  the **Tabby rail** (desktop) / **Tabby sheet** (mobile); `AssistantPanel`
  grows into it. Tab chrome is removed from the primary surface.
- **Rail anatomy**, top to bottom: header (TabbyAvatar + "Tabby · case desk");
  thread; suggestion-chip row; context strip; input.
- **Typed thread items** replace the current string-pair messages: at minimum
  `user_text`, `tabby_text` (markdown narration), `analysis_card`
  (structured result + frozen settings + run id), `receipt` (deterministic
  confirmations, e.g. filter changes), `notice` (errors/degraded state).
  Thread is session-scoped; no persistence change.
- **Badges**: rendered from server-emitted badge descriptors
  (`place_id`, run id, settings fingerprint, label). Live badges are keyed by
  run identity, not place ID alone; place edits/deletions and filter changes
  detach or clear badges via the existing `invalidateAnalysisContext` path.
  Historical cards remain in the thread but visibly detach from live badges.
- **Turn serialization**: every chat/command stream carries a `turn_id`;
  in-flight requests are abortable; tool effects from a stale turn are ignored
  (completed historical cards are still appended). Filter state changes flow
  through a single client-side reducer.
- **Filters stay client-owned**: the context strip and card chips edit
  `AnalysisSettings` locally through the reducer, appending a `receipt` item.
  The `update_filters` tool (below) returns a validated patch the client
  applies through the same reducer — never presented as server state.
- **Camera**: when an analysis lands, fly-to fits the analyzed places with
  sheet-aware padding (mobile: account for the sheet's current snap height).
- **Mobile sheet mechanics**: three snap heights with handle-only dragging,
  nearest-snap + velocity release logic, `visualViewport`-based keyboard
  handling, a single scroll owner (thread), and focus restoration.
- Topbar keeps brand, LayerToggle, DataFreshness, ThemeToggle, SearchPill,
  and a manage-places entry. `ManagePlacesModal` is unchanged.

### Backend

- **`POST /assistant/commands`** (new, public tier, session-guarded via
  `required_public_user_hash`): accepts a discriminated union of known commands
  (analyze, compare, add_place, select_places, update_filters, followups —
  a fixed enum, not a client-supplied tool name), executes via `execute_tool` +
  deterministic summary with **no LLM call**, and streams the same SSE event
  vocabulary as `/assistant/chat` so the client reducer is shared. Separate,
  non-LLM rate limit. Listed as public in `tests/test_internal_surface.py`.
  The three unadvertised tool handlers stay unreachable from the client.
- **`/assistant/chat`** unchanged in contract; planning + narration flow as
  today. New LLM-visible tool **`update_filters`**: validates a requested
  settings change and returns a patch (it does not persist anything).
- **Badge descriptors**: analyze/compare tool results gain an explicit
  per-place descriptor block (place id, run id, settings fingerprint) so the
  client never derives badge state from prose or infers it from result shape.
  Note: compare results are pairwise/cohort-shaped with no per-place-vs-
  baseline decision — presence badges sidestep this in v1; any future verdict
  badge must come from an explicit server-side label, not client inference.
- **Error/capability codes**: SSE `error` events carry machine-readable codes
  distinguishing LLM outage (→ degraded mode: disable free text only) from
  tool/validation/network failure (→ per-turn notice). The client may probe
  recovery cheaply (e.g. on next user action), no polling loop.
- **Proactive templates** are client-side deterministic strings + chip sets;
  the post-analysis chips come from the `suggest_followups` handler invoked as
  a command (or its logic reused server-side when emitting analysis results).
  Existing auto-run paths (share links, restored sessions) are audited so
  proactivity never double-fires an analysis.

### Safety invariants (unchanged, restated)

- Deterministic pre- and post-LLM safety-refusal guards stay as-is.
- Badges are presence-only in v1. Cards and narration use only the existing
  verdict vocabulary, always naming the metric and baseline as today's
  `CompareVerdict` copy does.
- Coordinate-coverage disclosures, API tiering, and export privacy controls
  are preserved (see Migration for where they land).

## Migration (staged tab removal)

The rail ships as the primary surface while Compare/Export remain reachable
behind an overflow entry. They are deleted only when a written **parity
checklist** passes, covering at least: address add/save/remove; explicit run;
exact date inputs; valid radius/category choices; share links; loading/error
a11y announcements; layer disclosures; baseline detail, trends, incident rows,
and methods sections; export privacy inclusion toggles; and run-scoped card
exports (today's CSV export uses the latest persisted run — card export must
be explicitly scoped to the card's run).

## Testing

- Frontend: thread-item rendering per type; badge descriptor → presence badge
  mapping incl. invalidation/detach; chip → command flow; turn staleness
  (stale stream cannot overwrite newer state); degraded-mode gating; sheet
  snap/keyboard behavior; context-strip reducer receipts.
- Backend: `/assistant/commands` enum validation (unknown commands rejected),
  no-LLM execution path, rate limiting, SSE parity with chat events;
  `update_filters` patch validation; badge descriptor emission; public/internal
  surface test updated for the new endpoint.
- Existing suites (analysis pins, `test_internal_surface`, exports) stay
  green. Gate: `make test-all`; end-to-end UI checks via the `/verify` skill.

## Slicing sketch (for the implementation plan)

1. Rail as primary surface (full-height AssistantPanel, typed thread items,
   context strip + reducer), Compare/Export intact behind overflow.
2. `/assistant/commands` + chips-as-commands + degraded mode.
3. Inline analysis cards with frozen settings + run-scoped export; post-
   analysis follow-up chips.
4. Presence badges + badge descriptors + fly-to with sheet-aware padding.
5. Proactive onboarding + place-added moments; auto-run path audit.
6. Mobile sheet snap mechanics.
7. Parity checklist pass → delete legacy tabs. Includes ARIA cleanup: slice 1
   removed the `role="tablist"`/`role="tab"` owners, so the `role="tabpanel"`
   on CompareTab/ExportTab/AddressLookup is orphaned — retire or downgrade
   those roles (e.g. to `role="region"`) when the tabs are deleted.

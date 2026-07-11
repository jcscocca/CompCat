# Analyst persona & upgraded dock — "Copper, case desk"

**Date:** 2026-07-10
**Status:** approved design, pre-implementation
**Phase:** 7 (public capstone) — demo-quality/UX slice

## Goal

Make the Analyst an obvious, welcoming part of the UI. Two aims weighted equally:
demo/portfolio memorability for the public capstone, and real discoverability (a
first-time visitor should immediately understand they can talk to the app).

The vehicle is a persona: **Copper**, a basset hound who runs the case desk — a
police-*adjacent* character that is deliberately not a sworn officer.

## Decisions made during brainstorm

| Question | Decision |
|---|---|
| Goal | Demo impact and real discoverability, equally |
| Tone register | Stylized professional (noir-lite), not playful mascot |
| Persona depth | Chrome + framing copy; answers' data content stays neutral |
| Placement | Upgraded dock (same position, richer presence) — not side rail, not floating launcher |
| Character | Copper the hound (case desk) — over Minerva the records owl and Dot the dispatcher |
| Art direction | Noir bust: fedora, heavy lids, trench collar, muted warm palette |

## 1. Character

Copper is a basset hound detective at the case desk: fedora, popped trench-coat
collar, heavy-lidded, laconic. The character is explicitly fictional and whimsical.

Hard rules:

- **No SPD insignia, badge, or uniform anywhere.** Fedora + trench codes
  "detective story", not "sworn officer". The persona never claims official status
  or affiliation with SPD.
- **"Analyst" remains the product term** in docs, aria-labels, and the API surface.
  Copper is the character who fills the role: "Copper · case desk" in the header,
  "the Waypoint analyst" in prose.

## 2. Voice

Register: dignified, laconic, warm-dry. Metaphor vocabulary is files / reports /
case desk. Persona copy never makes safety judgments and never editorializes about
places — the character exists to *reinforce* the product invariant ("I can tell you
what's on file, not whether somewhere is safe"), not to strain against it.

### Copy inventory (complete list of strings that change)

| Where | Today | Becomes |
|---|---|---|
| Header status (idle / busy) | "Ready" / "Working" | "At the desk" / "Checking the files…" |
| Empty-state greeting | "Ask about what the map is showing" | "Copper, case desk. Point me at a place and I'll pull the reports near it." |
| Suggestion chips | "What's near this pin?", "Compare my places" | Those two plus "What's on file around here?" (deictic — resolves against the current map view/pin, shipped in PR #121) |
| Offline error (frontend `OFFLINE_MESSAGE`) | "The analyst is offline right now. Your data is unaffected — the rest of Waypoint works." | "Copper can't reach the case files right now. Your data is unaffected — the rest of Waypoint works." |
| `_SAFETY_REDIRECT` (`app/assistant/agent.py`) | current redirect text | Reworded in-voice, same meaning and same redirect targets: "That's not something I can pull from the files — I can't label places safe or unsafe, rank them by safety, danger, or risk, or produce a personal safety score. I can order places by reported incident counts or compare exposure-adjusted incident rates — just ask it that way." |
| Tool summaries (`app/assistant/summaries.py`) | bare deterministic summary | Fixed lead-in "From the reports: " prefixed to `analyze_places` / `compare_places` summaries only. The deterministic data sentence itself is byte-identical. |

Everything else is untouched: clarification questions (`AssistantClarification`
messages), presence-claim redirect, all data content, the LLM planning prompt.

## 3. Dock UI

Placement and structure of the dock (`mc-dock` in
`frontend/src/components/AssistantPanel.tsx`, styles in
`frontend/src/styles/mapWorkspace.css`) are unchanged. What changes:

- **Header:** a 20px head-only Copper mark replaces the 7px `mc-dock-dot`, next to
  the name "Copper" and a small subtitle "case desk · analyst". Collapse button and
  behavior unchanged. `aria-label="Analyst"` stays.
- **Empty state:** the full noir bust (~72px) above the greeting and the three
  suggestion chips.
- **Asset:** a new `CopperAvatar` React component rendering inline SVG (props:
  `variant: "mark" | "bust"`, `size`). No image files, no asset pipeline. The warm
  hardcoded palette (browns/tans/charcoal) works on both light and night-mode
  surfaces. Final art is iterated during implementation from the approved sketch.

## 4. First-visit cue

- `localStorage` key `wp-copper-greeted` (repo convention, cf. `wp-theme`), unset → the
  avatar mark plays a
  subtle CSS pulse (two cycles on load) to draw the eye to the dock; set after the
  user sends their first assistant message.
- The pulse respects `prefers-reduced-motion: reduce` (no animation).
- No modal, no tour, no autoplayed messages.

## 5. Guardrails

- Persona strings (header, greeting, chips, summary lead-in) contain no
  safety/danger/risk lexicon. The reworded `_SAFETY_REDIRECT` deliberately names
  the refusal, exactly as today's does; it is deterministic pre-written copy and is
  not routed through the model-output guard.
- Existing guard behavior (`_contains_safety_ranking`, presence-claim guard,
  output ranking-prose guard) is not modified.
- The persona never implies the user was present at an incident, never claims SPD
  affiliation, never scores or ranks places.

## 6. Testing

- `AssistantPanel.test.tsx`: updated strings (status, greeting, chips, offline),
  new assertions for avatar presence and first-visit pulse gating (localStorage +
  reduced-motion).
- Backend: update tests asserting the exact `_SAFETY_REDIRECT` string; new test for
  the "From the reports: " lead-in on `analyze_places`/`compare_places` summaries
  and its absence elsewhere.
- Gate: `make test-all` (pytest + ruff + frontend test + build) before claiming done.

## 7. Scope and rollout

One slice in a dedicated worktree, roadmap-tick + PR per the usual cadence:

- Frontend: `AssistantPanel.tsx`, new `CopperAvatar.tsx`, `mapWorkspace.css`.
- Backend (copy strings only): `agent.py` (`_SAFETY_REDIRECT`), `summaries.py`
  (lead-in).
- Docs: persona note in `docs/architecture/assistant.md`; a DEMO.md beat
  introducing Copper.

### Out of scope

- Full persona voice in LLM free-text answers (no planning-prompt changes).
- Side-rail or floating-launcher layouts.
- Renaming the "Analyst" product term or any API surface.
- Animated/multi-pose character art beyond the two SVG variants.

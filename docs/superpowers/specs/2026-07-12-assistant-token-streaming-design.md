# Copper streamed finals + turn progress — design

**Date:** 2026-07-12
**Status:** approved (brainstorm 2026-07-12)
**Slice:** assistant token streaming (single PR)

## Problem

Copper's replies appear all at once after a long silence. The turn today is: one
non-streamed classify-only planning call (7–30s warm on the ThinkPad's gemma), then a
deterministic template summary emitted as a **single** SSE `token` event
(`app/assistant/agent.py`, `app/assistant/summaries.py`). Nothing streams because
nothing is generated incrementally — the "answer" is template text that exists all at
once. The first on-device iOS run (Slice A acceptance) surfaced this: checklist item 4
in `docs/IOS.md` asks for token-by-token streaming the app has never done.

## Decision trail (user choices, 2026-07-12)

1. **Real LLM finals** — reintroduce model-authored answers in Copper's voice, streamed
   live. Rejected: typewriter-only effect; typewriter + progress without real generation.
2. **Template becomes grounding only** — the streamed narration is the chat answer; the
   deterministic template is fed to the narrator as grounding and never shown. The
   numbers stay authoritative in the analysis panes the `tool` event already drives.
3. **Holdback-window guard** — near-token streaming with the invariant kept absolute.
   Rejected: sentence-gated emission (chunky); raw passthrough with retraction (a
   complete violating phrase could briefly render — weakens the invariant as written).
4. **Progress events included in this slice** — honest status lines kill the
   planning-phase dead air in the same PR.

Approach chosen: **additive second streamed narration call** (planning call untouched).
Rejected: streaming the planning call's JSON incrementally (tool turns would have
nothing to narrate until after the tool runs — Copper stays canned on the most common
turn type); rebuilding the turn as a native tool-calling streaming agent (demolishes the
Phase 1 decision tree that exists because gemma could not do reliable free-form agentic
turns).

## Relationship to prior decisions

Phase 1 (PR #56) removed the post-tool narration call because non-streamed narration
doubled an already-long wait and hung on gemma. Streaming changes that calculus: tokens
flow ~2–4s after the tool finishes. The open backlog item "full classify-only assistant
(strip free-text finals)" is **advanced, not reversed**: the plan's `message` field is
demoted from user-facing text to narrator grounding in this slice; removing it from the
planning prompt entirely is a deferred follow-up (kept out of this slice so
planning-prompt reliability on gemma is untouched).

## Design

### 1. SSE protocol (additive)

Two new event types beside `meta` / `token` / `tool` / `error` / `done`:

- `status` — `{"label": str}`. Honest phase markers: "interpreting your request…"
  after `meta`; "running <tool_name>…" before tool execution; "writing up…" before
  narration's first token. Transient UI, not part of the committed message.
- `replace` — `{"text": str}`. Wholesale-replaces the draft bubble. Emitted only on
  guard trips (text = the matching redirect) and narration-failure fallbacks
  (text = the deterministic template).

`token` events now carry many small deltas instead of one. The frontend already
accumulates deltas (`AssistantPanel.tsx`), and remote-URL mode means the frontend and
backend always ship together — no protocol version skew.

### 2. LLM client (`app/assistant/llm_client.py`)

`AssistantLlmClient` protocol gains:

```python
def stream(self, messages, *, role, temperature=None, max_tokens=None)
    -> AsyncIterator[str]
```

- `OpenAiLlmClient.stream`: POST `/chat/completions` with `"stream": True`; parse SSE
  `data:` lines, yield `choices[0].delta.content` chunks, stop on `[DONE]`. Uses httpx
  async streaming with the existing timeout structure. Yielding nothing (e.g. a
  reasoning model burning the budget on `reasoning_content`) raises `LlmUnavailable` at
  stream end, mirroring `complete()`'s empty-content check.
- `FailoverLlmClient.stream`: fail over to the next endpoint only on errors raised
  **before the first delta**. After tokens have flowed, a mid-stream failure propagates
  to the agent (you cannot unsay tokens by switching models); the agent's fallback
  ladder handles it.

### 3. Narration call

One streamed call per answering turn, made after tool execution (tool turns) or after
plan parsing (direct-answer turns):

- **System prompt:** Copper persona + hard grounding rules — restate only the facts
  provided; no safety scoring/ranking/livability language; no presence claims; the same
  invariant text the planning prompt carries.
- **Grounding payload (user message):** the recent user message(s); for tool turns the
  tool name, a trimmed tool-result JSON, and the deterministic template from
  `build_tool_summary`; for direct-answer turns the plan's `message` field as the
  narrator's draft.
- `max_tokens` ≈ 256, temperature ≈ 0.4, same model/endpoint chain as planning (no
  llama-swap model thrash).

Clarifications (`AssistantClarification`) and the safety/presence redirects stay
static, single-`token`, instant.

### 4. Holdback stream guard (`app/assistant/stream_guard.py` — new)

The invariant-critical piece. An async wrapper around the narration delta stream:

- Accumulates the full generated text; on **every** delta re-runs the existing three
  output-guard predicates (`_contains_safety_ranking`, `_output_ranks_places`,
  `_claims_user_presence`) over the entire accumulated text.
- Releases text only up to N words behind the write head, on word boundaries. N is a
  module constant sized above the longest guard phrase (~12 words).
- Guard trip → stop consuming, signal the agent; agent emits `replace` with the
  matching redirect. The violating suffix is never released — at worst an innocuous
  prefix briefly rendered.
- Stream end → one final full-text scan, then flush the held tail.

Invariant statement preserved: **a complete violating phrase can never render.**

### 5. Agent flow (`run_assistant_turn`)

```
meta
status("interpreting your request…")
planning call (unchanged, non-streamed, classify-only)
├─ tool plan:   status("running <tool>…") → execute_tool
│               tool event  (pane bridge fires BEFORE narration)
│               status("writing up…") → guarded narration stream → token*
│               done
├─ answer plan: status("writing up…") → guarded narration stream (draft = plan.message)
│               → token* → done
├─ clarify / redirects / errors: unchanged (static token or error, then done)
```

**Fallback ladder** (applies to both narration paths): narration unreachable, empty, or
dead mid-stream → `replace` with the deterministic template (tool turns) or the
full-text-guarded `plan.message` (direct-answer turns, exactly today's output) → `done`.
Every failure mode degrades to today's behavior, never below it.

### 6. Frontend (`frontend/src/api/client.ts`, `AssistantPanel.tsx`)

- `client.ts`: type the two new events; the SSE line parser is already generic.
- `AssistantPanel`: `status` renders as a transient italic line in the draft bubble,
  cleared on first `token`; `replace` resets the accumulated draft text to `data.text`.
  Token accumulation is unchanged. Existing tool-activity chips stay as-is.

### 7. Config

`MCA_ASSISTANT_NARRATION` (settings field `assistant_narration_enabled`, default
`True`). Off = skip the narration call and emit the deterministic template / plan
message exactly as today — a deploy-side kill switch, no code rollback needed.

### 8. Testing (gate: `make test-all`)

Backend, driven by a scripted fake streaming client:

- Multi-delta assembly into token events; status event ordering.
- A violating phrase walked across the holdback boundary — assert no released prefix
  ever contains a complete violating phrase; trip → `replace` with the correct redirect.
- Mid-stream death → `replace` with template; empty narration → template; narration
  unreachable → template (tool turn) / guarded plan.message (answer turn).
- Clarification and redirect paths byte-identical to today.
- Kill switch off → today's exact event sequence.

Unit: `stream_guard` release boundaries, word-boundary handling, final flush;
`OpenAiLlmClient.stream` SSE parsing via httpx MockTransport (including `[DONE]`,
malformed frames, empty stream); `FailoverLlmClient.stream` first-delta failover
semantics.

Frontend: AssistantPanel — status line render + clear, `replace` resets draft,
multi-delta accumulation.

### 9. Docs

- `docs/architecture` assistant doc: new event types, narration call, guard design.
- `docs/ROADMAP.md`: tick/add this slice.
- `docs/IOS.md` checklist item 4: after this ships, "Copper streams token-by-token"
  becomes literally true — the wording stays, and the on-device re-test becomes the
  real acceptance run for both this feature and Slice A item 4.

## Deferred / out of scope

- Stripping `message` from the planning prompt (full classify-only planning) —
  follow-up once narration is proven on gemma.
- Streaming for clarifications/redirects — static is correct there.
- Any change to planning-call latency itself.

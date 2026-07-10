# Demo-on-demand (Phase 7, Slice 2) — design

**Date:** 2026-07-10 · **Status:** approved design, pre-plan.
**Scope:** one slice — a shareable public demo of Waypoint, spun up on demand from the
ThinkPad through an ephemeral Cloudflare quick tunnel. Revises the phase spec's original
"small VPS + domain" posture (`docs/superpowers/specs/2026-07-09-public-capstone-design.md`);
the VPS + domain + durable README link become the deferred "for-real launch" follow-up.

## Why (and what changed from the phase spec)

Slice 1 shipped: the repo is public at `jcscocca/waypoint`. The remaining skim-audience
artifact is a live demo. Brainstormed 2026-07-10; the user's calls:

| Question | Answer |
|---|---|
| Hosting | **ThinkPad + Cloudflare quick tunnel now**; small VPS only at a future "for-real" launch |
| Domain | **Deferred** — ephemeral `trycloudflare.com` URL per demo session; no durable README link yet |
| Analyst LLM | **Groq free tier** (OpenAI-compatible), existing "analyst offline" state as fallback |

Consequence: this is a **demo-on-demand**, not an always-on service. It runs only while
the user is sharing it (an interview, an email). That lowers cost to zero, shrinks the
abuse window, and removes the need for a scheduled ingest cron — while everything built
here (limiter, LLM auth, demo env) transfers verbatim to the future VPS.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Demo isolation | **Second compose project on the ThinkPad** (`waypoint-demo`: own env file, own DB volume, own host port, e.g. 8001) | The existing ThinkPad instance has personal uploads enabled and the user's real places in its Postgres — it must never be tunnel-exposed. Hard constraint, not a preference. |
| Tunnel | **`cloudflared` quick tunnel** (`cloudflared tunnel --url http://localhost:<port>`) | No account, no domain, TLS + home-IP hiding for free; URL rotates per session — acceptable at this posture. Named tunnel/WAF deferred with the domain. |
| Rate limiter | **Hand-rolled in-process token buckets** (FastAPI middleware; no Redis, no new dependency), env-gated OFF by default | Single-host by design; the repo is dependency-lean; the logic is small and unit-testable. Protects the Groq quota and the home box. |
| LLM auth | **`MCA_LLM_API_KEY`** setting → `Authorization: Bearer` header in `app/assistant/llm_client.py` (primary + fallback endpoints) | The client was built for LAN llama-swap and sends no auth today; any hosted OpenAI-compatible API needs this. ~10 lines + tests. |
| Demo LLM | **Groq** (`MCA_LLM_BASE_URL=https://api.groq.com/openai/v1`), default model candidate `llama-3.3-70b-versatile` (env-overridable) | Fast classify (<2s vs gemma's 7–30s), $0 at demo traffic. Free-tier limits may shift — the existing offline state + Retry is the graceful floor. |
| Client IP | **`CF-Connecting-IP`, trusted only when `MCA_TRUST_PROXY_HEADERS=true`** | Behind cloudflared every request arrives from localhost; without the header all visitors share one bucket. Trust is opt-in so the header can't be spoofed in direct deployments. |
| Data | **Real SPD data, refreshed on demo start if stale** (admin ingest endpoint), no scheduled cron | The freshness pill keeps staleness honest; a cron for an instance that's usually off is YAGNI. |
| Seeding | **None** | Sessions are per-visitor, so seeded places would be invisible; the slice-C single-address-lookup landing is the demo entry. |

## Components

### 1. Rate limiter (the slice's substantial new code)

A small middleware + config surface in the backend:

- **Buckets** (all env-configured, all OFF unless `MCA_RATE_LIMIT_ENABLED=true`):
  - per-IP session creation (`POST /sessions`): default 10/hour — the "free sessions" cap
    the 2026-07 repo review left open by design;
  - per-session assistant calls (`POST /assistant/chat`): default 20/hour;
  - **global assistant daily cap**: default 100/day — the Groq-quota backstop; a plain
    process-lifetime counter with a UTC-day key;
  - general per-IP burst on public API routes: default 120/min.
- **Mechanics:** token buckets in an in-process dict keyed by IP / session hash, pruned
  lazily; 429 responses with a short, honest, invariant-safe message and `Retry-After`.
  The frontend chat panel already renders error states; no frontend work required.
- **Identity:** client IP = `CF-Connecting-IP` when `MCA_TRUST_PROXY_HEADERS=true`, else
  the socket peer. Session identity = the existing session hash.
- **Placement:** middleware for the IP tiers; the assistant caps enforced in the assistant
  route (it knows the session). Internal/admin routes exempt (they're not tunnel-reachable
  concerns and the admin endpoint has its own token).

### 2. LLM auth patch

`MCA_LLM_API_KEY` (and `MCA_LLM_FALLBACK_API_KEY`, defaulting to the primary) in
`app/config.py`; `llm_client.py` attaches `Authorization: Bearer <key>` when set. No
behavior change when unset (LAN llama-swap path untouched).

### 3. Demo overlay (ops, in-repo)

- `docker-compose.demo.yml` — override: project-distinct container names, demo host port
  (default 8001), separate named volumes (`waypoint_demo_db`, tiles read-only mount reused).
- `.env.demo.example` — the demo posture in one reviewable file: `MCA_ENVIRONMENT=production`
  (boot validator forces real secrets), uploads OFF, rate limiter ON, proxy-header trust ON,
  Groq base URL/model/key placeholder, fresh-random placeholders for salt/secret/admin token.
- `scripts/demo/start-demo.ps1` — compose up (demo project) → wait `/health` → if freshness
  older than 14 days, POST the admin Socrata ingest (token from env) → launch `cloudflared
  tunnel --url http://localhost:<port>` → print the ephemeral URL prominently.
  `scripts/demo/stop-demo.ps1` — tunnel down, compose down. PowerShell to match the
  existing ThinkPad deploy pattern (`start-waypoint.ps1`); cloudflared installed via winget.
- `docs/DEMO.md` — runbook: prerequisites (cloudflared, Groq key), start/stop, what the
  URL exposes, the isolation guarantee, and the "for-real launch" migration path (VPS,
  named tunnel or TLS, domain, README link — same env vars, no rework).

### 4. Live smoke (plan-time task, not code)

The classify prompt was tuned against gemma (JSON-firmness workarounds). One live
smoke of the decision-tree flow against Groq before calling the slice done; if the model
misbehaves on JSON, adjust `MCA_LLM_MODEL` choice first, prompt second.

## Error handling

- Groq unreachable/quota-exhausted → existing "analyst offline" panel + Retry; the global
  daily cap 429 shows the same graceful degradation rather than burning the upstream quota.
- Tunnel process dies → demo URL goes dark (acceptable at this posture; restart script).
- Boot with `MCA_ENVIRONMENT=production` and placeholder secrets → existing validator
  refuses to start (this is the guard that keeps a copy-pasted `.env.demo.example` from
  going live unedited).

## Testing

- Unit: bucket math (refill, burst, exhaustion, per-key isolation), UTC-day rollover of the
  global cap, header-trust gating (spoofed `CF-Connecting-IP` ignored when trust off),
  429 shape (`Retry-After`, message copy), auth header attach/absence.
- Integration: session-creation cap and assistant cap exercised through the FastAPI test
  client with the limiter enabled via env; everything else runs with it disabled (default),
  so the existing suite is unaffected.
- `make test-all` gate as always; the ops scripts are exercised by the live ThinkPad
  bring-up (a runbook step, like the soak harness — not in CI).

## Invariant checkpoint

No product-copy changes except 429 messages — which must speak of request limits, never
of place characteristics. The Analyst's deterministic safety-refusal guard is
model-independent and untouched; swapping gemma for Groq does not alter refusal behavior
(the guard runs before and after the model).

## Non-goals

- Always-on availability, uptime monitoring, scheduled ingest cron.
- Named tunnel, domain, Cloudflare WAF/zone config, VPS — all deferred to the
  "for-real launch".
- Pre-seeded demo content, guided tours, demo-specific frontend UI.
- Redis/distributed rate limiting, per-user accounts.

## Slice completion criteria

1. `make test-all` green with limiter default-off; limiter integration tests pass with it on.
2. Live ThinkPad bring-up: demo instance up on its own port/volume, personal instance
   untouched and not tunnel-reachable; ephemeral URL serves the dashboard end-to-end
   (address lookup → analyze → compare → export) over the tunnel.
3. Analyst answers over Groq through the tunnel within the caps; offline state verified by
   removing the key.
4. Rate limits observable in the wild: hammering `/sessions` or `/assistant/chat` from a
   second machine yields 429s with `Retry-After`.
5. Roadmap slice-2 entry updated to this revised posture and ticked.

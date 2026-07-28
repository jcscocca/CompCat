# Public instance, slice 1 — safety rails — design

**Date:** 2026-07-27 · **Status:** approved design, pre-plan.
**Scope:** backend + compose only, CI-testable, no infra. The rails that make it safe to put
a paid LLM key and a public URL on this codebase: a boot-time guard, a token budget, prod
posture warnings, and a production compose overlay. Parent:
`2026-07-27-public-instance-design.md`.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Boot guard trigger | **Prod-like env + any hosted-LLM key configured + `MCA_RATE_LIMIT_ENABLED=false` → refuse to boot**, same mechanism as `require_production_secret_overrides` | "Hosted key present" is the spend signal; provider name alone can't distinguish paid OpenAI from free Groq (both ride the `openai` provider). The keyless LAN llama-swap path (ThinkPad personal instance) is untouched |
| "Hosted-LLM key" definition | Any non-empty of `MCA_LLM_API_KEY`, `MCA_LLM_FALLBACK_API_KEY`, `MCA_OPENAI_API_KEY`, `MCA_ANTHROPIC_API_KEY` | Covers every provider path in `build_assistant_llm_client`, primary and fallback |
| Token budget | **`MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY`** (int; unset/0 = disabled): UTC-day global counter of prompt+completion tokens across planning and narration calls, enforced before each LLM call | Request-count caps bound calls, not cost; one long-context conversation can cost 100× a short one. Same in-process UTC-day mechanics as the existing global daily counter |
| Token accounting source | Provider-reported `usage` (OpenAI `include_usage` on streams, Anthropic `message_delta.usage`); **fallback estimate `ceil(chars/4)`** when a backend omits usage | An OpenAI-compatible endpoint that omits usage must not silently bypass the budget |
| Budget-exhausted UX | Assistant free-text returns a fixed, honest message over the existing SSE `error` path; `/assistant/commands` unaffected | Mirrors the offline state the frontend already renders; no frontend work |
| Prod posture warnings | Boot-time `logger.warning` when prod-like and `MCA_INTERNAL_TIER_ENABLED=true` or `MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true` | Both are one-line misconfigurations away from real exposure; warn loudly, don't block (both have legitimate single-host uses) |
| Prod compose overlay | **`docker-compose.prod.yml`**: no published `5432`, `POSTGRES_PASSWORD` required from env (no default), `restart: unless-stopped` on app/db | `docs/DEPLOY.md`'s own hardening note, promoted from an aside to a file. The dev/demo composes are unchanged |

## Components

### 1. LLM boot guard (`app/config.py`)

Extend the existing production-boot validation with `require_production_llm_rate_limit`:
prod-like environment + hosted key (definition above) + rate limiter disabled → raise at
startup with a message naming the exact envs to set (`MCA_RATE_LIMIT_ENABLED=true`, or remove
the key). Runs beside `require_production_secret_overrides`; same failure style.

### 2. Token budget (`app/ratelimit.py` + `app/assistant/`)

- `RateLimiterState` gains a UTC-day token counter beside the existing global daily call
  counter; `add_tokens(n)` / `budget_exceeded()` with lazy day rollover.
- The assistant turn checks the budget **before** the planning call and before the narration
  call; exceeded → the budget-exhausted SSE error (no upstream call made).
- Both LLM client paths report tokens after each call: provider `usage` when present, else
  the chars/4 estimate (prompt + completion).
- Enforcement requires `MCA_RATE_LIMIT_ENABLED=true` (it is part of the limiter, and the
  boot guard makes the limiter mandatory whenever a hosted key exists).

Budget-exhausted copy (fixed string, invariant-safe, no place language):
"Tabby's used up today's analysis budget. Free-text chat returns tomorrow — chips, filters,
and analysis still work."

### 3. Posture warnings (`app/main.py` startup)

One warning line each for internal-tier-enabled and uploads-enabled when prod-like, naming
the env var and the exposure ("internal tier is unauthenticated"; "personal uploads store
real location data — keep OFF on shared instances").

### 4. Prod compose overlay (`docker-compose.prod.yml`)

Override used as `docker compose -f docker-compose.yml -f docker-compose.prod.yml`:
removes the db port mapping, sources `POSTGRES_PASSWORD`/`DATABASE_URL` from env with no
default, adds restart policies. `.env.prod.example` lands in slice 4 with the full posture;
this slice ships the overlay + a README-level comment in the file header.

## Error handling

- Guard failure is a startup crash with an actionable message — identical UX to the existing
  secret validators (fail closed, never serve).
- Token-budget SSE error uses the existing frontend error rendering; Retry stays visible
  (retry after midnight UTC succeeds).
- Estimate-based accounting over-counts slightly (chars/4 on prose); acceptable — the budget
  is a backstop, not billing.

## Testing

- Config: guard trips for each key variable individually; does not trip when limiter on, when
  no key set, or when not prod-like. Existing validator tests as the template.
- Budget: rollover at UTC midnight, enforcement before planning and narration, `usage`-based
  and estimate-based accounting, exhausted-message shape, disabled when unset.
- Compose overlay: config-render assertion (`docker compose config`) in the docker CI lane —
  no `5432` publish, restart policies present.
- `make test-all` green; limiter-off default suite unaffected.

## Invariant checkpoint

One new user-visible string (budget-exhausted message, above) — speaks only of request
budgets, never of places. No guard or analysis changes.

## Non-goals

- Redis/persistent counters (restart resets the day's spend — accepted, single host).
- Per-session token budgets, billing integration, spend dashboards.
- Any change to dev/demo compose files or the personal ThinkPad deploy.

## Slice completion criteria

1. Prod-like boot with an Anthropic (or any hosted) key and limiter off refuses to start;
   same boot with limiter on starts clean.
2. With a 1,000-token test budget, the second assistant turn in a test run is refused with
   the fixed message and makes no upstream call.
3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` shows no
   published db port and no default password.
4. `make test-all` green.

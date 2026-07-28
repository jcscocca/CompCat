# Durable public instance (Phase 8) — design

**Date:** 2026-07-27 · **Status:** approved direction, umbrella spec — each slice has its own
spec → plan → PR.
**Scope:** the "for-real launch" that `docs/DEMO.md` deferred: CompCat served always-on from a
small VPS at a real domain, safe to leave up unattended. This revises Phase 7's closing note —
CompCat still does **not** become an operated multi-user service (no accounts, no tenancy),
but the demo stops being on-demand and becomes a durable public link.

## Why

A 2026-07-27 product review (three-lens: public-user utility, professionalism, operational
readiness) found the analytical core, invariant enforcement, and privacy engineering
launch-grade, and concentrated every real gap in four clusters:

1. **Spend/abuse rails are opt-in.** The rate limiter is env-gated OFF by default and
   `docs/DEPLOY.md` never mentions it; a paid LLM key behind the unauthenticated
   `/assistant/chat` is an uncapped cost surface. Caps are request-count, not token-based.
2. **The trust story never reaches the app.** Privacy posture, operator identity, Seattle-only
   scope, and the no-auth disclosure live only in README/docs; the app has no About/Privacy
   surface, no favicon, no meta/OG tags.
3. **Freshness is manual.** Ingest is a hand-run admin curl; an always-on instance goes stale
   silently.
4. **There is no durable host.** The public link today is an ephemeral quick tunnel off a
   personal laptop.

## Decisions (brainstormed 2026-07-27)

| Question | Answer |
|---|---|
| Release model | **Durable public instance** — session-based as today, no accounts; the operated-service pile (auth, tenancy, encryption at rest) stays deliberately unplanned |
| Hosting | **Small VPS** running the existing compose stack; provider deliberately open — the runbook is provider-agnostic with a pluggable "create the server" step |
| Analyst LLM | **Groq free tier wired for bring-up; Anthropic API is the production posture.** Both are first-class: the spend rails (boot guard, token budget) are designed for the paid key, not bolted on later. Failover pairs (e.g. Anthropic primary + Groq fallback) compose via the existing `MCA_LLM_FALLBACK_PROVIDER` |
| Domain | **Register a new one.** Open to readable variants beyond `compcat.*` if the obvious TLDs are taken; shortlist delivered with slice 1, registration is a user step |
| Operator identity in-app | **Name + GitHub link** ("Built by Jacob Scocca", repo link); no email published in-app |
| Ordering | **Code-first:** slices 1–3 land as CI-verified PRs before any public box exists; infra bring-up (slice 4) runs last against a hardened codebase, unblocked from domain registration |

## Slices

| Slice | Contents | Spec |
|---|---|---|
| 1 — Safety rails | LLM boot guard, daily token budget, prod-posture warnings, prod compose overlay (no published 5432, required DB password) | `2026-07-27-public-instance-slice1-safety-rails-design.md` |
| 2 — Trust surface | In-app About/Privacy panel, favicon + meta/OG, session-ephemerality hints, error-copy hygiene, export-label unification, pinch-zoom restore, SPD/NIBRS glosses | `2026-07-27-public-instance-slice2-trust-surface-design.md` |
| 3 — Freshness automation | Scheduled ingest sidecar, `GET /health/data` staleness probe | `2026-07-27-public-instance-slice3-freshness-automation-design.md` |
| 4 — VPS bring-up | Provider-agnostic runbook + scripts: hardening, TLS via Caddy, prod env posture, backups with rotation, soak pass, README live link | `2026-07-27-public-instance-slice4-vps-bringup-design.md` |

Worked one at a time per Conventions: squash-merge, re-cut the next slice from `origin/main`.

## Risks this design accepts

- **Single host, in-process state.** The rate limiter and session store remain per-process
  dicts; a restart resets buckets. Correct at this scale; Redis/multi-instance is a non-goal.
- **Deterministic safety guard stays English+Spanish.** Other languages ride on prompt-level
  instruction. Documented residual (`docs/ROADMAP.md` invariant-risk row), re-decided —
  script-aware matching remains unscheduled.
- **Home-grade ops.** No pager, no SLA; an external uptime monitor plus the staleness probe is
  the whole alerting story. The About panel does not promise uptime.

## Invariant checkpoint

New public-facing copy lands in slices 2 and 4 (About panel, meta description, OG text,
runbook-visible strings). All of it describes *reported incident context* and must never use
safe/unsafe/danger/risk language about places; the About panel restates the invariant
verbatim. No guard, engine, or analysis-copy changes anywhere in the phase.

## Non-goals

- Accounts, auth, tenant isolation, encryption at rest, durable user identity of any kind.
- Redis / distributed rate limiting, horizontal scaling, CDN.
- New analysis features, guard-language expansion, mobile app work.
- Uptime guarantees, on-call, paid monitoring.

## Phase completion criteria

1. The registered domain serves CompCat over HTTPS from the VPS, end-to-end (lookup →
   analyze → compare → export; Analyst answers within caps).
2. A prod-like boot with a hosted LLM key and the limiter off **refuses to start**.
3. Ingest runs unattended on schedule; `/health/data` goes unhealthy when it stops.
4. The About panel is reachable in-app and states operator, scope, storage, and the invariant.
5. Nightly DB backups exist with rotation, and a restore has been rehearsed once.
6. Soak-harness pass against the live box meets `docs/soak-testing.md` thresholds; README
   links the live instance.

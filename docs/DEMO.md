# Demo-on-demand runbook

Spin up a public, shareable Waypoint demo from the ThinkPad in ~2 minutes, and tear it
down when done. Design: `docs/superpowers/specs/2026-07-10-demo-on-demand-design.md`.

## What it is

- A **second, isolated compose project** (`waypoint-demo`) on the deploy machine: own
  Postgres volume, own port (8001), demo secrets, personal uploads OFF, rate limiting ON.
  The personal instance and its data are not reachable through the demo. The demo's
  Postgres is not host-published — it is reachable only inside the compose network (the
  personal instance keeps host 5432).
- An **ephemeral Cloudflare quick tunnel** (`https://<random>.trycloudflare.com`) — no
  account or domain; the URL changes every session and dies with the tunnel process.
- The **Analyst runs on Groq** (free tier) via `MCA_LLM_API_KEY`; if the key is absent or
  Groq is down, the app degrades to the built-in "analyst offline" panel.

## Prerequisites (one-time)

1. `winget install Cloudflare.cloudflared`
2. Groq API key: https://console.groq.com/keys
3. `cp .env.demo.example .env.demo` and fill in: two `openssl rand -hex 32` secrets, an
   admin token, the Groq key, and a geocoder contact email. The app refuses to boot in
   production mode with placeholders.

## Start / stop

    powershell -ExecutionPolicy Bypass -File scripts/demo/start-demo.ps1
    # ... share the printed trycloudflare.com URL; Ctrl+C kills the tunnel ...
    powershell -ExecutionPolicy Bypass -File scripts/demo/stop-demo.ps1

Start refreshes SPD data automatically when it's more than 14 days stale.

## Limits in force

Sessions 10/hour/IP · Analyst 20/hour/session and 100/day global · API burst 120/min/IP.
Tune via `MCA_RATE_LIMIT_*` in `.env.demo`.

## The "for-real" launch (deferred)

Same env vars and limiter on a small VPS, a named tunnel or plain TLS, a real domain, and
a durable README link. Nothing here needs rework for that move.

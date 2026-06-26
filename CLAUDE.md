# Waypoint — agent guide

Waypoint is a privacy-first web app for exploring **reported Seattle SPD incident
context** around places and routes. FastAPI + SQLAlchemy/Alembic backend, React +
TypeScript + Vite frontend, SQLite for dev / Postgres + PostGIS for deploy.

## Product invariant (do not break)

Waypoint reports *reported incident context*. It MUST NOT score safety, rank places as
safe/unsafe/dangerous, or claim a user was present at an incident. The assistant refuses
safety-score requests by design (`app/assistant/agent.py`). Keep this true in code and
copy.

## API tiers

- **Public** (in OpenAPI, require a real session via `required_public_user_hash`):
  `/sessions`, `/places*`, `/dashboard/*`, `/assistant/chat`, `/exports/tableau/*`.
  The React UI (`frontend/src/api/client.ts`) calls only this tier.
- **Internal** (`/internal/...`, `include_in_schema=False`, allow the demo-identity
  fallback `current_user_hash`): everything the UI does not call —
  `/internal/analysis/*`, `/internal/routes/*`, `/internal/imports*`, `/internal/crime/*`,
  `/internal/places`, `/internal/exports/*`. Do not re-expose these on bare public paths;
  `tests/test_internal_surface.py` enforces this.
- **Admin**: `/admin/crime/ingest/socrata` is guarded by the `X-Admin-Token` header
  (`MCA_ADMIN_INGEST_TOKEN`).

## Assistant LLM

The assistant calls an OpenAI-compatible endpoint directly: `MCA_LLM_BASE_URL`,
`MCA_LLM_MODEL`. If unreachable, only the chat panel is affected — the rest of the app
works. (The old LocalAgent gateway / `MCA_LOCALAGENT_BASE_URL` is being retired.)

## Verification gate

`make test-all` = `pytest` + `ruff check .` + frontend `npm test` + `npm run build`.
Run it before claiming work complete. Migrations: `make migrate` (alembic upgrade head).
Dev server: `make run` (uvicorn on :8000).

## Concurrent agents

Multiple agents work this repo at once. Do your work in a **dedicated git worktree**, not
the main checkout, to avoid collisions.

# CompCat — agent guide

CompCat is a privacy-first web app for exploring **reported Seattle SPD incident
context** around places. FastAPI + SQLAlchemy/Alembic backend, React +
TypeScript + Vite frontend, SQLite for dev / Postgres for deploy.

**Deep reference:** the architecture overview, data model, API contract, assistant design, and
the roadmap live under [`docs/`](docs/README.md) — start there before changing a subsystem.

## Product invariant (do not break)

CompCat reports *reported incident context*. It MUST NOT score safety, rank places as
safe/unsafe/dangerous, or claim a user was present at an incident. The assistant refuses
safety-score requests by design (`app/assistant/output_guard.py`, wired through
`app/assistant/agent.py`). Keep this true in code and copy.

## API tiers

- **Public** (in OpenAPI, require a real session via `required_public_user_hash`):
  `/sessions`, `/places*`, `/dashboard/*`, `/assistant/chat`, `/assistant/commands`,
  `/exports/tableau/*`, `/exports/analysis.csv`, and
  `/uploads` (personal data upload — new `POST` requests are additionally gated by
  `public_enable_personal_uploads`, off by default, while authenticated `DELETE` remains
  available for erasure). The React UI (`frontend/src/api/client.ts`) calls only this tier.
- **Internal** (`/internal/...`, `include_in_schema=False`, allow the demo-identity
  fallback `current_user_hash`): everything the UI does not call —
  `/internal/analysis/*`, `/internal/imports*`, `/internal/crime/*`,
  `/internal/places`, `/internal/exports/*`. Do not re-expose these on bare public paths;
  `tests/test_internal_surface.py` enforces this.
- **Admin**: `/admin/crime/ingest/socrata` and the schema-hidden
  `/admin/maintenance/retention-sweep` are guarded by the `X-Admin-Token` header
  (`MCA_ADMIN_INGEST_TOKEN`).

## Assistant LLM

The assistant backend is selectable via `MCA_LLM_PROVIDER` (client module
`app/assistant/llm_client.py`, wired in `build_assistant_llm_client`):

- `openai` (default) — any OpenAI-compatible `/chat/completions` endpoint (`MCA_LLM_BASE_URL`,
  `MCA_LLM_MODEL`): the local llama-swap default, Groq, or OpenAI itself.
- `openai_native` — OpenAI's own API via the official SDK (`MCA_OPENAI_API_KEY`, `MCA_OPENAI_MODEL`).
- `anthropic` — Claude via the official SDK (`MCA_ANTHROPIC_API_KEY`, `MCA_ANTHROPIC_MODEL`).

`MCA_LLM_FALLBACK_PROVIDER` picks the optional failover backend independently, so any pair
composes (e.g. Claude primary + local fallback). If the active backend is unreachable, only the
chat panel is affected — the rest of the app works. (The old LocalAgent gateway and its
`MCA_LOCALAGENT_BASE_URL` env var have been retired.)

## Verification gate

`make test-all` = `pytest` + `ruff check .` + frontend `npm test` + `npm run build`.
Run it before claiming work complete. Migrations: `make migrate` (alembic upgrade head).
Dev server: `make run` (uvicorn on :8000).

## Concurrent agents

Multiple agents work this repo at once. Do your work in a **dedicated git worktree**, not
the main checkout, to avoid collisions.

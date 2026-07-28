# Public instance — Slice 1 (Safety rails) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it safe to put a paid LLM key and a public URL on this codebase: refuse to boot
when a hosted LLM key is configured without rate limiting, cap daily LLM spend with a UTC-day
token budget enforced before every model call, warn loudly at boot about prod-like exposure
toggles, and ship a production compose overlay that never publishes Postgres.

**Architecture:** Four independent, additive pieces. (1) A fourth `model_validator(mode="after")`
on `Settings`, beside `require_production_secret_overrides` — same fail-closed style, same crash-at-
boot mechanism. (2) A second UTC-day counter inside `RateLimiterState` (tokens, beside the existing
global call counter), fed by the LLM clients via a new `record_llm_tokens()` and read by the
assistant turn before each upstream call. (3) A `log_posture_warnings()` call at the top of
`create_app`. (4) `docker-compose.prod.yml` as a pure overlay (`!reset` on the db `ports`), asserted
by a pytest render test plus a CI docker-lane step. Backend + compose only; no frontend work — the
budget refusal rides the SSE `error` path the chat panel already renders.

**Tech Stack:** FastAPI + pydantic-settings, pytest (`.venv/bin/python -m pytest`), ruff
(line-length 100, `select = ["E", "F", "I", "UP", "B"]`), Docker Compose v2 overlay merge.

**Working context:** Worktree `/Users/jscocca/Repos/compcat/.worktrees/p8-slice1-safety-rails`,
branch `p8-slice1-safety-rails`. Spec:
`docs/superpowers/specs/2026-07-27-public-instance-slice1-safety-rails-design.md` (committed at
`8bc57c5`, decision-complete — do not re-open decisions). Gate: `make test-all` from the worktree
root. **Prerequisite:** this worktree has no `.venv` yet — run `make install` from the worktree root
once before Task 1 (creates `.venv` and installs `-e '.[dev]'`). Every backend test command below is
`.venv/bin/python -m pytest ...`; the `pytest` shebang in the venv is stale, so never invoke bare
`pytest`.

**Invariant (do not break):** the budget-exhausted message is the **only** new user-facing string in
this slice. It must never mention places, addresses, neighborhoods, safety, danger, or risk. Operator-
facing strings (boot errors, log warnings) also avoid `risk`/`safety` vocabulary so no copy guard can
ever trip on them.

---

## Verified wire facts this plan relies on

Read from this worktree at plan time.

**Config (`app/config.py`)**
- `Settings` is a `BaseSettings` with `env_prefix="MCA_"`, `env_file=".env"` (`app/config.py:26`).
- Hosted-key attributes, exact names: `llm_api_key` and `llm_fallback_api_key` (`app/config.py:77-78`),
  `anthropic_api_key` (`app/config.py:86`), `openai_api_key` (`app/config.py:94`). All four are
  `str` defaulting to `""` — never `None`, so `.strip()` is safe.
- `rate_limit_enabled: bool = False` (`app/config.py:103`); the demo rate-limit block ends at
  `rate_limit_burst_per_minute: int = 120` (`app/config.py:111`) — the new budget setting goes there.
- `is_production_like` is a property: `environment.lower() not in LOCAL_ENVIRONMENTS`
  (`app/config.py:128-136`, `LOCAL_ENVIRONMENTS` at `app/config.py:22`). Fails closed.
- Failure mechanism to mirror: `require_production_secret_overrides` (`app/config.py:152-169`) is a
  `@model_validator(mode="after")` that early-returns on `not self.is_production_like`, collects
  offending **env var names** into a list, and `raise ValueError(...)` with them joined. Pydantic wraps
  it as `ValidationError` at construction, so the app crashes at import/boot.
  `require_production_geocoder_contact` (`app/config.py:171-180`) is the second instance of the pattern.
  `mode="after"` validators run in definition order, so the new one runs last.
- `get_settings()` is `@lru_cache`d (`app/config.py:183-189`); `tests/conftest.py:11-17` clears it
  before every test, so `monkeypatch.setenv` works in tests.

**Rate limiter (`app/ratelimit.py`)**
- `RateLimiterState.__init__` holds `self._lock = threading.Lock()`, `self._buckets`,
  `self._global_day_key: str = ""`, `self._global_count: int = 0` (`app/ratelimit.py:15-21`).
- The global daily counter to mirror is `try_count_global(*, limit, day_key=None)`
  (`app/ratelimit.py:54-64`): defaults `day_key` to `datetime.now(UTC).strftime("%Y-%m-%d")`, takes
  the lock, **lazily** resets the count when the day key changed, then compares against `limit`.
  That is exactly the UTC-day mechanic the token counter copies.
- Module state is a singleton `_state` behind `get_rate_limiter()` (`app/ratelimit.py:67-71`), reset by
  `reset_rate_limiter()` (`app/ratelimit.py:74-77`), which `tests/conftest.py:36-40` calls autouse per
  test — so token counters start at 0 in every test.
- `app/ratelimit.py` imports nothing from `app.*`, so `app/assistant/llm_client.py` importing it
  creates no cycle.

**Assistant turn (`app/assistant/agent.py`)**
- `run_assistant_turn(session, user_id_hash, messages, dashboard_state, llm_client)` is an async
  generator of `AssistantStreamEvent` (`app/assistant/agent.py:180-186`); first event is always `meta`
  (`:189-192`).
- Input guards run next: safety-score (`:195-198`) and presence-claim (`:199-202`), each yielding
  `token` + `done` and returning. **The budget check goes immediately after these**, before
  `narrate = settings.assistant_narration_enabled` (`:204`) so no dangling `status` event precedes it.
- **Planning call:** `await llm_client.complete(build_planning_messages(...), role=..., temperature=0.2,
  max_tokens=1024)` at `app/assistant/agent.py:216-221`, preceded by `session.rollback()` (`:213`).
- **Narration call site 1 (tool path):** `yield ... status _STATUS_WRITING` (`:260`) → `build_tool_grounding`
  → `session.rollback()` → `_stream_final(...)` (`:264-274`).
- **Narration call site 2 (final-answer path):** `yield ... status _STATUS_WRITING` (`:294`) →
  `session.rollback()` → `_stream_final(...)` (`:297-306`).
- `_stream_final` (`:354-391`) is the only place `llm_client.stream(...)` is called
  (`:367-372`), wrapped in `guarded_stream`.
- Error-event shape already in use: `AssistantStreamEvent(event="error", data={"message": ..., "code": ...})`,
  emitted with **no trailing `done`** (`:224-227` for `llm_unreachable`, `:229` for `internal`,
  `:250-253` for `tool_error`). The budget error follows that shape exactly.
- `AssistantStreamEvent` is `event: Literal["meta","tool","token","status","replace","done","error"]`
  + `data: dict[str, Any]` (`app/assistant/schemas.py:66-68`) — `error` needs no schema change.

**SSE emission (`app/api/routes_assistant.py`)**
- `/assistant/chat` streams `run_assistant_turn` through `_sse_event()` →
  `f"event: {event.event}\ndata: {json.dumps(event.data, default=str)}\n\n"`
  (`app/api/routes_assistant.py:164-185`, `:256-257`). An `error` event yielded by the agent reaches the
  browser unchanged — no route change is needed for the budget refusal.
- The existing per-day call cap lives in the route, not the agent:
  `limiter.try_count_global(limit=settings.rate_limit_assistant_global_per_day)`
  (`app/api/routes_assistant.py:156`), gated by `settings.rate_limit_enabled` (`:139`).
- `build_assistant_llm_client(settings)` lives here (`:122-129`), not in `llm_client.py`, and can
  return any of `OpenAiLlmClient` / `OpenAiNativeLlmClient` / `AnthropicLlmClient` / `FailoverLlmClient`
  (`:76-129`) — so all three concrete clients need token accounting, and `FailoverLlmClient` needs none
  (it delegates).

**LLM clients (`app/assistant/llm_client.py`)**
- `OpenAiLlmClient.complete` parses `data["choices"][0]["message"].get("content")` from the JSON body
  (`:115-120`) — the same body carries `usage` when the host reports it, so `data.get("usage")` is the
  hook. `payload` spreads `**self.extra_body` **first** so core fields always win (`:95-102`, `:138-145`).
- `OpenAiLlmClient.stream` iterates SSE lines, `break`s on `[DONE]`, and swallows frames whose
  `chunk["choices"][0]` lookup raises `(KeyError, IndexError, TypeError)` (`:161-178`). The
  `include_usage` frame arrives with **empty `choices`** and a top-level `usage`, so usage must be read
  **before** the choices lookup or it is discarded by that `continue`.
- `AnthropicLlmClient.complete` returns `_anthropic_text(response)` (`:296`); the SDK response object
  carries `.usage` with `input_tokens`/`output_tokens`. `AnthropicLlmClient.stream` iterates
  `stream.text_stream` inside `async with ... messages.stream(...)` (`:314-320`); the accumulated
  `usage` is reachable via `await stream.get_final_message()` **after** the loop.
- `OpenAiNativeLlmClient._request_kwargs` builds the kwargs and sets `stream=True` only in the stream
  path (`:387-406`); `complete` reads `_openai_message_text(response)` (`:422`) and the response object
  carries `.usage`.
- Every stream method already tracks a `yielded` flag and maps failures to
  `LlmUnavailable` / `LlmStreamInterrupted` (`:179-196`, `:321-330`, `:448-455`). A `finally:` added to
  each stream body also runs on `aclose()` (guard trip / client disconnect), which is how an abandoned
  narration still gets charged.
- Existing client test fakes carry **no** `usage` attribute: `_Response`/`_StreamCtx`
  (`tests/test_anthropic_llm_client.py:25-63`), `SimpleNamespace` responses/chunks
  (`tests/test_openai_native_llm_client.py:19-27`). So `getattr(x, "usage", None) → None` and the
  estimate path keeps every existing test green.

**Startup (`app/main.py`)**
- There is **no** lifespan/startup hook. `create_app(database_url=None)` (`app/main.py:62-94`) is the
  single boot path: `configure_database` → `init_db` → routers → `mount_dashboard` →
  `app.add_middleware(BurstLimitMiddleware, ...)` (`:93`). `app = create_app()` at module import
  (`:97`). Posture warnings therefore go at the top of `create_app`. `app/main.py` currently imports no
  `logging` and imports only `get_settings` from `app.config` (`:23`).

**Compose + CI**
- `docker-compose.yml` publishes Postgres at `ports: ["5432:5432"]` (`docker-compose.yml:19-20`), sets
  `POSTGRES_PASSWORD: mca` (`:17`), and both services use `restart: "no"` (`:23`, `:95`). The api service
  reads `MCA_DATABASE_URL: ${MCA_DATABASE_URL:-postgresql+psycopg://mca:mca@db:5432/mca}` (`:35`).
- `docs/DEPLOY.md:134-137` already documents this hardening as an aside ("drop the `db` `ports:`
  mapping … and set a real DB password") — this slice promotes it to a file.
- CI has four lanes; the docker lane is `.github/workflows/ci.yml:70-73`, currently a single
  `docker build .` step. Adding a second step there is trivial, so **that is the choice** (no new make
  target). A pytest render test is added alongside it so `make test-all` stays meaningful locally.
- **Verified by running it** (Docker Compose v5.1.4, this Mac): with `ports: !reset []` in the overlay,
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` renders **no**
  `published: "5432"`, keeps `published: "8000"`, and emits `restart: unless-stopped` twice. A plain
  `ports: []` would **not** work — Compose merges sequences, so only the `!reset` tag removes the base
  publish. With `POSTGRES_PASSWORD` unset the render exits 1 with
  `required variable POSTGRES_PASSWORD is missing a value`. `--env-file /dev/null` makes the render
  ignore a stray repo-root `.env` while still reading process env, which keeps the "missing password
  fails" test hermetic.

---

## Task 1: Boot guard — hosted LLM key requires rate limiting

**Files:**
- Modify: `app/config.py`
- Create: `tests/test_config_llm_guard.py`

- [x] **Step 1: Write the failing test**

Create `tests/test_config_llm_guard.py`:

```python
from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def _prod(**env) -> dict[str, object]:
    """Prod-like settings with every *other* production requirement already satisfied, so only
    the field under test can fail (see tests/test_public_sessions.py for the same pattern)."""
    base: dict[str, object] = {
        "environment": "production",
        "user_hash_salt": "test-production-salt",
        "session_secret": "test-production-session-secret",
        "geocoder_contact_email": "ops@example.com",
    }
    base.update(env)
    return base


def _settings(**env) -> Settings:
    return Settings(_env_file=None, **env)


@pytest.mark.parametrize(
    ("field", "env_name"),
    [
        ("llm_api_key", "MCA_LLM_API_KEY"),
        ("llm_fallback_api_key", "MCA_LLM_FALLBACK_API_KEY"),
        ("openai_api_key", "MCA_OPENAI_API_KEY"),
        ("anthropic_api_key", "MCA_ANTHROPIC_API_KEY"),
    ],
)
def test_hosted_key_without_rate_limiting_refuses_to_boot(field: str, env_name: str) -> None:
    with pytest.raises(ValidationError) as excinfo:
        _settings(**_prod(**{field: "sk-test-key"}))
    message = str(excinfo.value)
    assert "MCA_RATE_LIMIT_ENABLED" in message
    assert env_name in message


def test_hosted_key_boots_when_rate_limiting_is_on() -> None:
    settings = _settings(**_prod(anthropic_api_key="sk-test-key", rate_limit_enabled=True))
    assert settings.rate_limit_enabled is True
    assert settings.is_production_like is True


def test_keyless_production_boots_without_rate_limiting() -> None:
    # The LAN llama-swap path (no hosted key) is untouched by the guard.
    settings = _settings(**_prod())
    assert settings.rate_limit_enabled is False


def test_local_environment_is_never_gated() -> None:
    settings = _settings(environment="local", anthropic_api_key="sk-test-key")
    assert settings.is_production_like is False
    assert settings.rate_limit_enabled is False


def test_error_names_every_configured_key() -> None:
    with pytest.raises(ValidationError, match="MCA_LLM_API_KEY, MCA_ANTHROPIC_API_KEY"):
        _settings(**_prod(llm_api_key="sk-a", anthropic_api_key="sk-b"))


def test_blank_key_does_not_trip_the_guard() -> None:
    settings = _settings(**_prod(llm_api_key="   "))
    assert settings.rate_limit_enabled is False
```

- [x] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_config_llm_guard.py -v`
Expected: FAIL — the four parametrized cases and `test_error_names_every_configured_key` fail with
`DID NOT RAISE <class 'pydantic_core.ValidationError'>`. The three "boots cleanly" tests already pass.

- [x] **Step 3: Add the validator**

In `app/config.py`, insert directly after `require_production_geocoder_contact` (which ends with
`return self` at line 180) and before the `@lru_cache`/`get_settings` block:

```python
    @model_validator(mode="after")
    def require_production_llm_rate_limit(self) -> Settings:
        """A configured hosted-LLM key is the spend signal — the provider name alone cannot tell a
        paid endpoint from a free one (Groq and OpenAI both ride the "openai" provider). Prod-like
        + any hosted key + the limiter off would leave metered spend exposed to an open URL, so
        refuse to boot. The keyless LAN llama-swap path is untouched."""
        if not self.is_production_like or self.rate_limit_enabled:
            return self

        key_names = [
            name
            for name, value in (
                ("MCA_LLM_API_KEY", self.llm_api_key),
                ("MCA_LLM_FALLBACK_API_KEY", self.llm_fallback_api_key),
                ("MCA_OPENAI_API_KEY", self.openai_api_key),
                ("MCA_ANTHROPIC_API_KEY", self.anthropic_api_key),
            )
            if value.strip()
        ]
        if key_names:
            joined_names = ", ".join(key_names)
            raise ValueError(
                f"Production deployments with a hosted LLM key ({joined_names}) must set "
                "MCA_RATE_LIMIT_ENABLED=true — an unmetered key behind a public URL can run up "
                "real spend. Set it to true, or unset the key to use a keyless endpoint."
            )
        return self
```

- [x] **Step 4: Run to verify it passes, plus the neighbouring config/secret suites**

Run: `.venv/bin/python -m pytest tests/test_config_llm_guard.py tests/test_config_demo.py tests/test_public_sessions.py tests/test_internal_surface.py -v`
Expected: PASS (9 new tests; every existing config/production-boot test still green — the prod-like
tests in those files set no LLM key, so the new validator is inert for them).

- [x] **Step 5: Commit**

```bash
git add app/config.py tests/test_config_llm_guard.py
git commit -m "feat(config): refuse prod boot when a hosted LLM key runs without rate limiting"
```

---

## Task 2: Daily token counter in `RateLimiterState` + the budget setting

**Files:**
- Modify: `app/ratelimit.py`
- Modify: `app/config.py`
- Modify: `tests/test_ratelimit.py`
- Modify: `tests/test_config_demo.py`

- [x] **Step 1: Write the failing tests**

Append to `tests/test_ratelimit.py`:

```python
def test_token_budget_accumulates_and_rolls_over_at_utc_midnight() -> None:
    state = RateLimiterState()
    assert state.budget_exceeded(limit=100, day_key="2026-07-27") is False
    state.add_tokens(60, day_key="2026-07-27")
    assert state.budget_exceeded(limit=100, day_key="2026-07-27") is False
    state.add_tokens(40, day_key="2026-07-27")
    assert state.budget_exceeded(limit=100, day_key="2026-07-27") is True
    # New UTC day: the counter resets lazily on first touch, exactly like the call counter.
    assert state.budget_exceeded(limit=100, day_key="2026-07-28") is False


def test_token_budget_is_disabled_for_a_non_positive_limit() -> None:
    state = RateLimiterState()
    state.add_tokens(10_000, day_key="2026-07-27")
    assert state.budget_exceeded(limit=0, day_key="2026-07-27") is False
    assert state.budget_exceeded(limit=-1, day_key="2026-07-27") is False


def test_add_tokens_returns_the_day_total_and_ignores_non_positive() -> None:
    state = RateLimiterState()
    assert state.add_tokens(25, day_key="2026-07-27") == 25
    assert state.add_tokens(0, day_key="2026-07-27") == 25
    assert state.add_tokens(-5, day_key="2026-07-27") == 25


def test_token_counter_is_independent_of_the_daily_call_counter() -> None:
    state = RateLimiterState()
    state.add_tokens(500, day_key="2026-07-27")
    assert state.try_count_global(limit=1, day_key="2026-07-27") is True
    assert state.budget_exceeded(limit=400, day_key="2026-07-27") is True
    assert state.try_count_global(limit=1, day_key="2026-07-27") is False
```

Append to `tests/test_config_demo.py`:

```python
def test_assistant_token_budget_defaults_disabled() -> None:
    s = _settings()
    assert s.assistant_token_budget_per_day == 0


def test_assistant_token_budget_reads_the_env_var(monkeypatch) -> None:
    monkeypatch.setenv("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY", "250000")
    assert Settings(_env_file=None).assistant_token_budget_per_day == 250000
```

- [x] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_ratelimit.py tests/test_config_demo.py -v`
Expected: FAIL — `AttributeError: 'RateLimiterState' object has no attribute 'budget_exceeded'`
(4 tests) and `AttributeError: 'Settings' object has no attribute 'assistant_token_budget_per_day'`
(2 tests). The pre-existing tests in both files still pass.

- [x] **Step 3: Add the token counter**

In `app/ratelimit.py`, extend `RateLimiterState.__init__` (currently lines 16-21) — add the two
fields after `self._global_count`:

```python
        self._global_day_key: str = ""
        self._global_count: int = 0
        # Second UTC-day counter, same mechanics: LLM tokens (prompt + completion) spent across
        # every assistant call today. Fed by app/assistant/llm_client.record_llm_tokens; read by
        # the assistant turn before each upstream call.
        self._token_day_key: str = ""
        self._token_count: int = 0
```

Then add these two methods directly after `try_count_global` (which ends at line 64), before the
module-level `_state = RateLimiterState()`:

```python
    def add_tokens(self, tokens: int, *, day_key: str | None = None) -> int:
        """Charge LLM tokens against the current UTC day; returns the new day total."""
        day_key = day_key or datetime.now(UTC).strftime("%Y-%m-%d")
        with self._lock:
            if day_key != self._token_day_key:
                self._token_day_key = day_key
                self._token_count = 0
            if tokens > 0:
                self._token_count += tokens
            return self._token_count

    def budget_exceeded(self, *, limit: int, day_key: str | None = None) -> bool:
        """True when today's recorded tokens have reached a positive limit. A limit <= 0 means
        no budget is configured, so nothing is ever exceeded."""
        if limit <= 0:
            return False
        day_key = day_key or datetime.now(UTC).strftime("%Y-%m-%d")
        with self._lock:
            if day_key != self._token_day_key:
                self._token_day_key = day_key
                self._token_count = 0
            return self._token_count >= limit
```

- [x] **Step 4: Add the setting**

In `app/config.py`, insert after `rate_limit_burst_per_minute: int = 120` (line 111), inside the
same demo/public rate-limiting block:

```python
    # Shared daily LLM token budget (prompt + completion, all assistant calls, UTC day).
    # 0 = disabled. Enforced only when rate_limit_enabled — and the boot guard above makes the
    # limiter mandatory whenever a hosted LLM key is configured in a prod-like environment.
    assistant_token_budget_per_day: int = 0
```

- [x] **Step 5: Run to verify they pass**

Run: `.venv/bin/python -m pytest tests/test_ratelimit.py tests/test_config_demo.py tests/test_ratelimit_api.py -v`
Expected: PASS (6 new tests; the existing limiter and rate-limit API suites unchanged and green).

- [x] **Step 6: Commit**

```bash
git add app/ratelimit.py app/config.py tests/test_ratelimit.py tests/test_config_demo.py
git commit -m "feat(ratelimit): UTC-day LLM token counter and MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY"
```

---

## Task 3: Token accounting in the LLM clients

Every completed call charges the counter: provider-reported `usage` when present, else a
`ceil(chars/4)` estimate over prompt + completion. All three concrete clients are covered because
`build_assistant_llm_client` can return any of them (`app/api/routes_assistant.py:76-129`).

**Files:**
- Modify: `app/assistant/llm_client.py`
- Modify: `tests/test_openai_llm_client.py`
- Modify: `tests/test_anthropic_llm_client.py`
- Modify: `tests/test_openai_native_llm_client.py`

- [x] **Step 1: Write the failing tests — OpenAI-compatible client**

In `tests/test_openai_llm_client.py`, add `from app.ratelimit import get_rate_limiter` to the imports
(after the `from app.assistant.llm_client import ...` line), then append at the end of the file:

```python
# ---------- daily token budget accounting ----------


def test_complete_records_provider_reported_usage(monkeypatch: pytest.MonkeyPatch) -> None:
    response_data = {
        "choices": [{"message": {"content": "hi"}}],
        "usage": {"prompt_tokens": 30, "completion_tokens": 12},
    }

    async def fake_post(self_client, url, **kwargs):  # noqa: ANN001
        return _json_response(response_data)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    asyncio.run(_make_client().complete([{"role": "user", "content": "hello"}], role=None))

    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=42) is True
    assert limiter.budget_exceeded(limit=43) is False


def test_complete_falls_back_to_the_char_estimate(monkeypatch: pytest.MonkeyPatch) -> None:
    # A host that omits usage must not silently bypass the budget.
    async def fake_post(self_client, url, **kwargs):  # noqa: ANN001
        return _json_response({"choices": [{"message": {"content": "hi"}}]})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)
    asyncio.run(_make_client().complete([{"role": "user", "content": "hello"}], role=None))

    # ceil(5/4) for the prompt "hello" + ceil(2/4) for the completion "hi" = 3
    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=3) is True
    assert limiter.budget_exceeded(limit=4) is False


def test_stream_asks_for_usage_and_records_the_final_frame(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}
    response = _FakeStreamResponse(
        [
            _sse_line("Hel"),
            _sse_line("lo"),
            'data: {"choices":[],"usage":{"prompt_tokens":80,"completion_tokens":20}}',
            "data: [DONE]",
        ]
    )
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def fake_stream(self_client, method, url, **kwargs):  # noqa: ANN001
        captured.update(kwargs.get("json") or {})
        yield response

    monkeypatch.setattr(httpx.AsyncClient, "stream", fake_stream)
    assert asyncio.run(_collect_stream(_make_client())) == ["Hel", "lo"]

    assert captured["stream_options"] == {"include_usage": True}
    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=100) is True
    assert limiter.budget_exceeded(limit=101) is False


def test_abandoned_stream_still_spends_its_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    # The output guard tripping (or a client disconnect) closes the generator mid-stream. Tokens
    # already generated upstream must still be charged, or the budget is trivially bypassable.
    _patch_stream(monkeypatch, _FakeStreamResponse([_sse_line("abcd"), _sse_line("efgh")]))

    async def run() -> None:
        gen = _make_client().stream([{"role": "user", "content": "hi"}], role=None)
        assert await gen.__anext__() == "abcd"
        await gen.aclose()

    asyncio.run(run())

    # prompt "hi" -> ceil(2/4) = 1, completion seen so far "abcd" -> ceil(4/4) = 1
    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=2) is True
    assert limiter.budget_exceeded(limit=3) is False
```

- [x] **Step 2: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_openai_llm_client.py -v`
Expected: FAIL — the four new tests fail (`budget_exceeded(limit=42)` is `False`: nothing is being
recorded; the `stream_options` assertion raises `KeyError`). All pre-existing tests in the file pass.

- [x] **Step 3: Add the accounting helpers**

In `app/assistant/llm_client.py`, extend the import block (top of file) — add `import math` to the
stdlib group and the first-party import after the third-party group:

```python
import asyncio
import contextlib
import json
import logging
import math
from collections.abc import AsyncIterator
from typing import Protocol

import anthropic
import httpx
import openai

from app.ratelimit import get_rate_limiter
```

Then insert these module-level helpers directly after
`_OPENAI_NATIVE_DEFAULT_MAX_TOKENS = 1024` (line 17) and before `class AssistantLlmClient(Protocol):`:

```python
def _estimate_tokens(text: str) -> int:
    """~4 characters per token. Used only when a backend reports no usage — an OpenAI-compatible
    endpoint that omits usage must not silently bypass the daily budget. Over-counts slightly on
    prose; the budget is a spend backstop, not billing."""
    return math.ceil(len(text) / 4)


def _usage_field(usage: object, *names: str) -> int:
    for name in names:
        value = usage.get(name) if isinstance(usage, dict) else getattr(usage, name, None)
        if isinstance(value, int):
            return value
    return 0


def _usage_tokens(usage: object) -> int | None:
    """prompt+completion tokens from a provider usage payload — OpenAI
    (prompt_tokens/completion_tokens) or Anthropic (input_tokens/output_tokens), as a dict or an
    SDK object. None when the backend reported nothing usable."""
    if usage is None:
        return None
    total = _usage_field(usage, "prompt_tokens", "input_tokens") + _usage_field(
        usage, "completion_tokens", "output_tokens"
    )
    return total or None


def record_llm_tokens(
    messages: list[dict[str, str]], completion: str, usage: object = None
) -> None:
    """Charge one LLM call against the shared daily token budget (app/ratelimit.py). Pure
    accounting — it runs whether or not rate limiting is on; enforcement lives in the assistant
    turn."""
    tokens = _usage_tokens(usage)
    if tokens is None:
        prompt = "".join(str(message.get("content") or "") for message in messages)
        tokens = _estimate_tokens(prompt) + _estimate_tokens(completion)
    get_rate_limiter().add_tokens(tokens)
```

- [x] **Step 4: Wire the OpenAI-compatible client**

In `OpenAiLlmClient.complete`, replace the content-extraction block (lines 115-126):

```python
        try:
            content = data["choices"][0]["message"].get("content")
        except (KeyError, IndexError, TypeError) as exc:
            raise LlmUnavailable(
                "LLM endpoint returned an unexpected response shape."
            ) from exc
        record_llm_tokens(messages, content or "", data.get("usage"))
        if not content or not content.strip():
            raise LlmUnavailable(
                "LLM returned empty content (a reasoning model may have spent the token "
                "budget on reasoning_content — disable thinking or use an instruct model)."
            )
        return content
```

Then replace the whole of `OpenAiLlmClient.stream` (lines 128-196) with:

```python
    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        # Spread extra_body first so the core fields below always win and can
        # never be clobbered by caller-supplied options.
        payload: dict[str, object] = {
            **self.extra_body,
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": True,
            # Ask for the trailing usage frame so the daily token budget counts real tokens;
            # hosts that ignore the option fall back to the chars/4 estimate below.
            "stream_options": {"include_usage": True},
        }
        timeout = httpx.Timeout(self.timeout_s, connect=self.connect_timeout_s)
        yielded = False
        usage: dict[str, object] | None = None
        parts: list[str] = []
        try:
            # asyncio.timeout bounds the total stream duration (see max_stream_seconds); on
            # expiry it raises TimeoutError, handled by the generic except below (degrades to
            # LlmStreamInterrupted once text has been emitted, else LlmUnavailable).
            async with asyncio.timeout(self.max_stream_seconds):
                async with httpx.AsyncClient(timeout=timeout) as client:
                    async with client.stream(
                        "POST",
                        f"{self.base_url}/chat/completions",
                        json=payload,
                        headers=self.request_headers(),
                    ) as response:
                        response.raise_for_status()
                        async for line in response.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            data = line[len("data:") :].strip()
                            if data == "[DONE]":
                                break
                            try:
                                chunk = json.loads(data)
                            except ValueError:
                                continue
                            if not isinstance(chunk, dict):
                                continue
                            # The include_usage frame carries empty choices, so read usage
                            # before the choices lookup below discards the frame.
                            usage_frame = chunk.get("usage")
                            if isinstance(usage_frame, dict):
                                usage = usage_frame
                            try:
                                delta = chunk["choices"][0].get("delta") or {}
                            except (KeyError, IndexError, TypeError):
                                continue
                            content = delta.get("content")
                            if content:
                                yielded = True
                                parts.append(content)
                                yield content
        except httpx.HTTPError as exc:
            if yielded:
                raise LlmStreamInterrupted(
                    f"LLM stream died mid-generation: {exc}"
                ) from exc
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        except Exception as exc:  # non-HTTP transport/decode oddities degrade the same way
            if yielded:
                raise LlmStreamInterrupted(
                    f"LLM stream died mid-generation: {exc}"
                ) from exc
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        finally:
            # Also runs on aclose() (output-guard trip, client disconnect), so an abandoned
            # narration still spends what it generated.
            record_llm_tokens(messages, "".join(parts), usage)
        if not yielded:
            raise LlmUnavailable(
                "LLM returned an empty stream (a reasoning model may have spent the "
                "token budget on reasoning_content — disable thinking or use an "
                "instruct model)."
            )
```

- [x] **Step 5: Run the OpenAI-compatible suite**

Run: `.venv/bin/python -m pytest tests/test_openai_llm_client.py tests/test_llm_client_auth.py tests/test_failover_llm_client.py -v`
Expected: PASS (4 new tests plus every existing one — the malformed-frame, `[DONE]`, mid-stream-death
and extra_body tests all still hold).

- [x] **Step 6: Write the failing Anthropic tests**

In `tests/test_anthropic_llm_client.py`, add `from app.ratelimit import get_rate_limiter` to the
imports, then teach the two fakes about usage.

Replace `_Response` (lines 25-27) with:

```python
class _Response:
    def __init__(self, blocks: list[_Block], usage: object | None = None) -> None:
        self.content = blocks
        self.usage = usage
```

In `_StreamCtx.__init__` (lines 33-44), add a `usage` keyword and store it:

```python
    def __init__(
        self,
        texts: list[str],
        *,
        enter_exc: Exception | None = None,
        iter_exc: Exception | None = None,
        error_after: int | None = None,
        usage: object | None = None,
    ) -> None:
        self._texts = texts
        self._enter_exc = enter_exc
        self._iter_exc = iter_exc
        self._error_after = error_after
        self._usage = usage
```

and add this method to `_StreamCtx` (after `_agen`):

```python
    async def get_final_message(self):
        return SimpleNamespace(usage=self._usage)
```

Then append the new tests at the end of the file:

```python
# ---------- daily token budget accounting ----------


def test_complete_records_reported_usage() -> None:
    msgs = _FakeMessages(
        response=_Response(
            [_Block("text", "ok")], usage=SimpleNamespace(input_tokens=70, output_tokens=5)
        )
    )
    asyncio.run(_client(msgs).complete([{"role": "user", "content": "hi"}]))

    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=75) is True
    assert limiter.budget_exceeded(limit=76) is False


def test_stream_records_final_message_usage() -> None:
    msgs = _FakeMessages(
        stream_ctx=_StreamCtx(["ok"], usage=SimpleNamespace(input_tokens=40, output_tokens=8))
    )
    _collect(_client(msgs), [{"role": "user", "content": "hi"}])

    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=48) is True
    assert limiter.budget_exceeded(limit=49) is False


def test_stream_without_usage_falls_back_to_the_char_estimate() -> None:
    msgs = _FakeMessages(stream_ctx=_StreamCtx(["abcdefgh"]))
    _collect(_client(msgs), [{"role": "user", "content": "hi"}])

    # prompt "hi" -> ceil(2/4) = 1, completion "abcdefgh" -> ceil(8/4) = 2
    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=3) is True
    assert limiter.budget_exceeded(limit=4) is False
```

- [x] **Step 7: Run to verify the Anthropic tests fail**

Run: `.venv/bin/python -m pytest tests/test_anthropic_llm_client.py -v`
Expected: FAIL — the three new tests fail (`budget_exceeded(limit=75)` is `False`); the pre-existing
Anthropic tests still pass (the fakes gained optional fields only).

- [x] **Step 8: Wire the Anthropic client**

In `app/assistant/llm_client.py`, add this helper directly after `_anthropic_text` (lines 222-228):

```python
async def _anthropic_final_usage(stream: object) -> object | None:
    """The accumulated usage for a completed Anthropic stream. Defensive: a stream object with no
    get_final_message (or one that refuses after a partial iteration) degrades to the estimate."""
    getter = getattr(stream, "get_final_message", None)
    if getter is None:
        return None
    try:
        return getattr(await getter(), "usage", None)
    except Exception:  # a partial/abandoned stream has no final message — estimate instead
        return None
```

In `AnthropicLlmClient.complete`, replace lines 296-302 with:

```python
        content = _anthropic_text(response)
        record_llm_tokens(messages, content, getattr(response, "usage", None))
        if not content or not content.strip():
            raise LlmUnavailable(
                "LLM returned empty content (the model may have refused or spent its token "
                "budget on reasoning)."
            )
        return content
```

Replace the body of `AnthropicLlmClient.stream` (lines 312-330) with:

```python
        yielded = False
        usage: object | None = None
        parts: list[str] = []
        try:
            async with self._ensure_client().messages.stream(
                **self._request_kwargs(messages, max_tokens)
            ) as stream:
                async for text in stream.text_stream:
                    if text:
                        yielded = True
                        parts.append(text)
                        yield text
                usage = await _anthropic_final_usage(stream)
        except Exception as exc:  # API, transport, or decode failure — degrade uniformly
            if yielded:
                raise LlmStreamInterrupted(
                    f"LLM stream died mid-generation: {exc}"
                ) from exc
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        finally:
            # Also runs on aclose() (output-guard trip, client disconnect), where usage is still
            # None and the chars/4 estimate charges what was generated.
            record_llm_tokens(messages, "".join(parts), usage)
        if not yielded:
            raise LlmUnavailable(
                "LLM returned an empty stream (the model may have refused or produced no text)."
            )
```

- [x] **Step 9: Run the Anthropic suite**

Run: `.venv/bin/python -m pytest tests/test_anthropic_llm_client.py -v`
Expected: PASS (3 new tests + all existing).

- [x] **Step 10: Write the failing OpenAI-native tests**

In `tests/test_openai_native_llm_client.py`, add `from app.ratelimit import get_rate_limiter` to the
imports, add this helper next to `_resp` (line 19-20):

```python
def _resp_with_usage(content: str, usage: object):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))], usage=usage
    )
```

and append at the end of the file:

```python
# ---------- daily token budget accounting ----------


def test_complete_records_reported_usage() -> None:
    comp = _FakeCompletions(
        response=_resp_with_usage(
            "hello", SimpleNamespace(prompt_tokens=25, completion_tokens=5)
        )
    )
    asyncio.run(_client(comp).complete([{"role": "user", "content": "hi"}]))

    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=30) is True
    assert limiter.budget_exceeded(limit=31) is False


def test_stream_asks_for_usage_and_records_the_final_chunk() -> None:
    usage_chunk = SimpleNamespace(
        choices=[], usage=SimpleNamespace(prompt_tokens=60, completion_tokens=4)
    )
    comp = _FakeCompletions(stream=_FakeStream([_chunk("ok"), usage_chunk]))
    _collect(_client(comp), [{"role": "user", "content": "hi"}])

    assert comp.captured["stream_options"] == {"include_usage": True}
    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=64) is True
    assert limiter.budget_exceeded(limit=65) is False


def test_stream_without_usage_falls_back_to_the_char_estimate() -> None:
    comp = _FakeCompletions(stream=_FakeStream([_chunk("abcdefgh")]))
    _collect(_client(comp), [{"role": "user", "content": "hi"}])

    # prompt "hi" -> 1, completion "abcdefgh" -> 2
    limiter = get_rate_limiter()
    assert limiter.budget_exceeded(limit=3) is True
    assert limiter.budget_exceeded(limit=4) is False
```

- [x] **Step 11: Run to verify they fail**

Run: `.venv/bin/python -m pytest tests/test_openai_native_llm_client.py -v`
Expected: FAIL — the three new tests fail (nothing recorded; `stream_options` missing from
`comp.captured`). All existing tests pass.

- [x] **Step 12: Wire the OpenAI-native client**

In `OpenAiNativeLlmClient._request_kwargs`, replace the `if stream:` branch (lines 404-405) with:

```python
        if stream:
            kwargs["stream"] = True
            # Trailing usage chunk for the daily token budget; harmless when a proxy drops it.
            kwargs["stream_options"] = {"include_usage": True}
```

In `OpenAiNativeLlmClient.complete`, replace lines 422-425 with:

```python
        content = _openai_message_text(response)
        record_llm_tokens(messages, content, getattr(response, "usage", None))
        if not content or not content.strip():
            raise LlmUnavailable("LLM returned empty content.")
        return content
```

Replace the body of `OpenAiNativeLlmClient.stream` (lines 435-455) with:

```python
        yielded = False
        usage: object | None = None
        parts: list[str] = []
        try:
            chunks = await self._ensure_client().chat.completions.create(
                **self._request_kwargs(messages, temperature, max_tokens, stream=True)
            )
            # async with so an abandoned generator (disconnect, guard trip) closes the SDK
            # stream instead of leaking the connection and server-side generation.
            async with chunks:
                async for chunk in chunks:
                    usage = getattr(chunk, "usage", None) or usage
                    text = _openai_delta_text(chunk)
                    if text:
                        yielded = True
                        parts.append(text)
                        yield text
        except Exception as exc:  # API, transport, or decode failure — degrade uniformly
            if yielded:
                raise LlmStreamInterrupted(
                    f"LLM stream died mid-generation: {exc}"
                ) from exc
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        finally:
            # Also runs on aclose() (output-guard trip, client disconnect).
            record_llm_tokens(messages, "".join(parts), usage)
        if not yielded:
            raise LlmUnavailable("LLM returned an empty stream.")
```

- [x] **Step 13: Run every LLM client suite + ruff**

Run: `.venv/bin/python -m pytest tests/test_openai_llm_client.py tests/test_openai_native_llm_client.py tests/test_anthropic_llm_client.py tests/test_failover_llm_client.py tests/test_llm_client_auth.py tests/test_assistant_api.py -v`
Expected: PASS (10 new tests; every existing client and assistant-API test green).

Run: `.venv/bin/ruff check .`
Expected: clean (watch the 100-char line limit in the new helpers).

- [x] **Step 14: Commit**

```bash
git add app/assistant/llm_client.py tests/test_openai_llm_client.py tests/test_anthropic_llm_client.py tests/test_openai_native_llm_client.py
git commit -m "feat(assistant): charge every LLM call against the daily token budget"
```

---

## Task 4: Enforce the budget in the assistant turn

**Files:**
- Modify: `app/assistant/agent.py`
- Create: `tests/test_assistant_token_budget.py`

- [x] **Step 1: Write the failing test**

Create `tests/test_assistant_token_budget.py`:

```python
from __future__ import annotations

import asyncio

import pytest

from app.assistant.agent import run_assistant_turn
from app.assistant.schemas import AssistantChatMessage, AssistantDashboardState
from app.db import get_sessionmaker
from app.main import create_app
from app.models import PlaceCluster
from app.ratelimit import get_rate_limiter

# The one new user-facing string in this slice. Pinned as a literal (not imported) so a copy
# change has to be deliberate.
_BUDGET_MESSAGE = (
    "Tabby's used up today's analysis budget. Free-text chat returns tomorrow — "
    "chips, filters, and analysis still work."
)


class BudgetFakeClient:
    """Records what the turn actually sent upstream and, like the real clients, charges the
    daily token counter for each completed call."""

    def __init__(self, responses: list[str], *, tokens_per_call: int = 0) -> None:
        self.responses = responses
        self.tokens_per_call = tokens_per_call
        self.complete_calls = 0
        self.stream_calls = 0

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        self.complete_calls += 1
        if self.tokens_per_call:
            get_rate_limiter().add_tokens(self.tokens_per_call)
        return self.responses.pop(0)

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ):
        self.stream_calls += 1
        yield "narrated"


def _session(tmp_path):
    create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    session = get_sessionmaker()()
    session.add(
        PlaceCluster(
            id="place-1",
            user_id_hash="user-1",
            cluster_version="manual-v1",
            cluster_method="manual",
            centroid_latitude=47.61,
            centroid_longitude=-122.33,
            display_latitude=47.61,
            display_longitude=-122.33,
            visit_count=3,
            sensitivity_class="normal",
            display_label="Library stop",
            inferred_place_type="manual_place",
            label_source="test",
        )
    )
    session.commit()
    return session, "user-1"


def _run(session, user_hash, client):
    async def go():
        return [
            event
            async for event in run_assistant_turn(
                session,
                user_hash,
                [AssistantChatMessage(role="user", content="What do you see?")],
                AssistantDashboardState(selected_place_ids=["place-1"]),
                client,
            )
        ]

    return asyncio.run(go())


def test_turn_refuses_before_the_planning_call_when_the_budget_is_spent(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY", "1000")
    session, user_hash = _session(tmp_path)
    get_rate_limiter().add_tokens(1000)
    client = BudgetFakeClient(['{"type":"final","message":"never reached"}'])
    try:
        events = _run(session, user_hash, client)
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "error"]
    assert events[1].data["message"] == _BUDGET_MESSAGE
    assert events[1].data["code"] == "budget_exhausted"
    assert client.complete_calls == 0  # no upstream call was made


def test_turn_refuses_before_narration_when_planning_spends_the_budget(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_ASSISTANT_NARRATION_ENABLED", "true")
    monkeypatch.setenv("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY", "1000")
    session, user_hash = _session(tmp_path)
    client = BudgetFakeClient(
        ['{"type":"final","message":"One saved stop is selected."}'], tokens_per_call=1200
    )
    try:
        events = _run(session, user_hash, client)
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "status", "error"]
    assert events[2].data["message"] == _BUDGET_MESSAGE
    assert client.complete_calls == 1
    assert client.stream_calls == 0  # narration never reached the model


def test_turn_is_unaffected_when_no_budget_is_configured(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "true")
    monkeypatch.setenv("MCA_ASSISTANT_NARRATION_ENABLED", "false")
    monkeypatch.delenv("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY", raising=False)
    session, user_hash = _session(tmp_path)
    get_rate_limiter().add_tokens(10_000_000)
    client = BudgetFakeClient(['{"type":"final","message":"One saved stop is selected."}'])
    try:
        events = _run(session, user_hash, client)
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]
    assert client.complete_calls == 1


def test_budget_is_not_enforced_when_rate_limiting_is_off(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_RATE_LIMIT_ENABLED", "false")
    monkeypatch.setenv("MCA_ASSISTANT_NARRATION_ENABLED", "false")
    monkeypatch.setenv("MCA_ASSISTANT_TOKEN_BUDGET_PER_DAY", "1000")
    session, user_hash = _session(tmp_path)
    get_rate_limiter().add_tokens(5_000)
    client = BudgetFakeClient(['{"type":"final","message":"One saved stop is selected."}'])
    try:
        events = _run(session, user_hash, client)
    finally:
        session.close()

    assert [event.event for event in events] == ["meta", "token", "done"]


def test_budget_message_stays_out_of_place_and_safety_vocabulary() -> None:
    lowered = _BUDGET_MESSAGE.lower()
    for banned in (
        "safe",
        "unsafe",
        "safety",
        "danger",
        "risk",
        "place",
        "address",
        "neighborhood",
        "incident",
    ):
        assert banned not in lowered
```

- [x] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_assistant_token_budget.py -v`
Expected: FAIL — the first two tests fail (no `error` event; the turn runs the planning call
anyway). The last three already pass.

- [x] **Step 3: Implement enforcement**

In `app/assistant/agent.py`, add the rate-limiter import after `from app.config import get_settings`
(line 30):

```python
from app.config import get_settings
from app.ratelimit import get_rate_limiter
```

Add the message and the two helpers next to the other module constants — directly after
`_STATUS_WRITING = "writing up…"` (line 177):

```python
# Shared daily LLM token budget exhausted. Fixed copy, invariant-safe: it speaks only about the
# request budget — never about places, addresses, or safety.
_BUDGET_EXHAUSTED_MESSAGE = (
    "Tabby's used up today's analysis budget. Free-text chat returns tomorrow — "
    "chips, filters, and analysis still work."
)


def _budget_exhausted(settings) -> bool:
    """True when today's shared token budget is spent. Enforcement rides the rate limiter
    (MCA_RATE_LIMIT_ENABLED); an unset/zero budget disables it entirely."""
    if not settings.rate_limit_enabled:
        return False
    return get_rate_limiter().budget_exceeded(limit=settings.assistant_token_budget_per_day)


def _budget_error_event() -> AssistantStreamEvent:
    return AssistantStreamEvent(
        event="error",
        data={"message": _BUDGET_EXHAUSTED_MESSAGE, "code": "budget_exhausted"},
    )
```

Then add the three checkpoints inside `run_assistant_turn`.

**(a) Before the planning call** — after the presence-claim guard block (ends line 202) and before
`narrate = settings.assistant_narration_enabled` (line 204):

```python
    # Budget checkpoint 1 of 2: refuse before the planning call, so an exhausted day makes no
    # upstream request at all. Placed before the status event so the UI gets no dangling spinner.
    if _budget_exhausted(settings):
        yield _budget_error_event()
        return
```

**(b) Before narration in the tool path** — replace line 260,
`yield AssistantStreamEvent(event="status", data={"label": _STATUS_WRITING})`, inside the
`if plan.get("type") == "tool_call":` branch (immediately after the `if not narrate:` early return),
with:

```python
        if _budget_exhausted(settings):
            yield _budget_error_event()
            return
        yield AssistantStreamEvent(event="status", data={"label": _STATUS_WRITING})
```

**(c) Before narration in the final-answer path** — replace line 294,
`yield AssistantStreamEvent(event="status", data={"label": _STATUS_WRITING})` (the one after the
`if not narrate or redirect is not None:` block), with the identical three lines:

```python
    if _budget_exhausted(settings):
        yield _budget_error_event()
        return
    yield AssistantStreamEvent(event="status", data={"label": _STATUS_WRITING})
```

- [x] **Step 4: Run to verify it passes, with the full assistant suite**

Run: `.venv/bin/python -m pytest tests/test_assistant_token_budget.py tests/test_assistant_agent.py tests/test_assistant_api.py tests/test_assistant_commands_api.py tests/test_ratelimit_api.py -v`
Expected: PASS (5 new tests; the whole existing assistant suite green — with no budget configured
`_budget_exhausted` is always `False`, so every existing path is unchanged).

- [x] **Step 5: Commit**

```bash
git add app/assistant/agent.py tests/test_assistant_token_budget.py
git commit -m "feat(assistant): refuse free-text turns once the daily token budget is spent"
```

---

## Task 5: Boot-time posture warnings

**Files:**
- Modify: `app/main.py`
- Create: `tests/test_startup_posture.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_startup_posture.py`:

```python
from __future__ import annotations

import logging

import pytest

from app.config import Settings
from app.main import create_app, log_posture_warnings


def _prod_settings(**env) -> Settings:
    return Settings(
        _env_file=None,
        environment="production",
        user_hash_salt="test-production-salt",
        session_secret="test-production-session-secret",
        geocoder_contact_email="ops@example.com",
        **env,
    )


def test_internal_tier_warning_names_the_env_var_and_the_exposure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(_prod_settings(internal_tier_enabled=True))
    assert "MCA_INTERNAL_TIER_ENABLED" in caplog.text
    assert "internal tier is unauthenticated" in caplog.text


def test_personal_uploads_warning_names_the_env_var_and_the_exposure(
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(_prod_settings(public_enable_personal_uploads=True))
    assert "MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS" in caplog.text
    assert "personal uploads store real location data" in caplog.text
    assert "keep OFF on shared instances" in caplog.text


def test_default_production_posture_is_quiet(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(_prod_settings())
    assert caplog.text == ""


def test_local_environment_never_warns(caplog: pytest.LogCaptureFixture) -> None:
    settings = Settings(
        _env_file=None,
        environment="local",
        internal_tier_enabled=True,
        public_enable_personal_uploads=True,
    )
    with caplog.at_level(logging.WARNING, logger="app.main"):
        log_posture_warnings(settings)
    assert caplog.text == ""


def test_create_app_emits_the_posture_warning(
    tmp_path, caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("MCA_ENVIRONMENT", "production")
    monkeypatch.setenv("MCA_USER_HASH_SALT", "test-production-salt")
    monkeypatch.setenv("MCA_SESSION_SECRET", "test-production-session-secret")
    monkeypatch.setenv("MCA_GEOCODER_CONTACT_EMAIL", "ops@example.com")
    monkeypatch.setenv("MCA_INTERNAL_TIER_ENABLED", "true")
    with caplog.at_level(logging.WARNING, logger="app.main"):
        create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'mca.sqlite3'}")
    assert "internal tier is unauthenticated" in caplog.text
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_startup_posture.py -v`
Expected: FAIL — collection error, `ImportError: cannot import name 'log_posture_warnings' from
'app.main'`.

- [ ] **Step 3: Implement**

In `app/main.py`, add `import logging` to the stdlib imports (above `from pathlib import Path`),
change the config import to `from app.config import Settings, get_settings` (line 23), and add the
logger + function directly after the imports, before `def mount_dashboard(app: FastAPI) -> None:`:

```python
logger = logging.getLogger(__name__)


def log_posture_warnings(settings: Settings) -> None:
    """Loud boot-time warnings for prod-like postures that are one env var away from real
    exposure. Warn, never block — both toggles have legitimate single-host uses."""
    if not settings.is_production_like:
        return
    if settings.internal_tier_enabled:
        logger.warning(
            "MCA_INTERNAL_TIER_ENABLED=true in a production-like environment: the "
            "internal tier is unauthenticated — keep it behind a trusted boundary."
        )
    if settings.public_enable_personal_uploads:
        logger.warning(
            "MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true in a production-like environment: "
            "personal uploads store real location data — keep OFF on shared instances."
        )
```

Then call it as the first statement of `create_app`:

```python
def create_app(database_url: str | None = None) -> FastAPI:
    log_posture_warnings(get_settings())
    configure_database(database_url)
    init_db()
```

- [ ] **Step 4: Run to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_startup_posture.py tests/test_health.py tests/test_internal_surface.py -v`
Expected: PASS (5 new tests; app construction unchanged everywhere else).

- [ ] **Step 5: Commit**

```bash
git add app/main.py tests/test_startup_posture.py
git commit -m "feat(app): warn at boot about prod-like internal-tier and personal-upload exposure"
```

---

## Task 6: Production compose overlay + render assertion

**Choice recorded:** the CI docker lane is a single `docker build .` step
(`.github/workflows/ci.yml:70-73`), so adding a render assertion there is trivial — no make target
is needed. A pytest test is added alongside it so `make test-all` catches a broken overlay locally;
it skips only when the Docker CLI/compose plugin is absent, and CI runners always have both.

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `tests/test_compose_prod_overlay.py`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the failing test**

Create `tests/test_compose_prod_overlay.py`:

```python
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest

_ROOT = Path(__file__).resolve().parents[1]
_BASE = _ROOT / "docker-compose.yml"
_PROD = _ROOT / "docker-compose.prod.yml"

_TEST_PASSWORD = "ci-not-a-real-password"
_TEST_DATABASE_URL = f"postgresql+psycopg://mca:{_TEST_PASSWORD}@db:5432/mca"


def test_overlay_documents_its_own_usage_and_sources_secrets_from_env() -> None:
    text = _PROD.read_text(encoding="utf-8")
    assert "docker compose -f docker-compose.yml -f docker-compose.prod.yml" in text
    # !reset, not an empty list: Compose merges sequences, so only the tag drops the base publish.
    assert "ports: !reset []" in text
    assert "${POSTGRES_PASSWORD:?" in text
    assert "${MCA_DATABASE_URL:?" in text
    assert text.count("restart: unless-stopped") == 2
    assert ":-" not in text  # no dev fallback defaults anywhere in the production overlay


def _compose_available() -> bool:
    if shutil.which("docker") is None:
        return False
    probe = subprocess.run(
        ["docker", "compose", "version"], capture_output=True, text=True, check=False
    )
    return probe.returncode == 0


def _render(
    env_overrides: dict[str, str], drop: tuple[str, ...] = ()
) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    env.update(env_overrides)
    for name in drop:
        env.pop(name, None)
    return subprocess.run(
        [
            "docker",
            "compose",
            # /dev/null so a stray repo-root .env cannot supply the required variables.
            "--env-file",
            "/dev/null",
            "-f",
            str(_BASE),
            "-f",
            str(_PROD),
            "config",
        ],
        cwd=_ROOT,
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )


def test_rendered_overlay_publishes_no_postgres_port() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render(
        {"POSTGRES_PASSWORD": _TEST_PASSWORD, "MCA_DATABASE_URL": _TEST_DATABASE_URL}
    )
    assert result.returncode == 0, result.stderr
    rendered = result.stdout
    assert 'published: "5432"' not in rendered
    assert 'published: "8000"' in rendered  # the app is still reachable
    assert rendered.count("restart: unless-stopped") == 2


def test_rendered_overlay_refuses_to_render_without_a_db_password() -> None:
    if not _compose_available():
        pytest.skip("docker compose plugin not available")
    result = _render({"MCA_DATABASE_URL": _TEST_DATABASE_URL}, drop=("POSTGRES_PASSWORD",))
    assert result.returncode != 0
    assert "POSTGRES_PASSWORD" in result.stderr
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_compose_prod_overlay.py -v`
Expected: FAIL — `FileNotFoundError` / render errors, because `docker-compose.prod.yml` does not
exist yet.

- [ ] **Step 3: Create the overlay**

Create `docker-compose.prod.yml`:

```yaml
# Production overlay — layered on top of the base compose file, never used alone:
#
#   docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
#
# What it changes versus the dev/demo default:
#   - Postgres is NOT published on the host (the api reaches db over the compose network);
#   - POSTGRES_PASSWORD and MCA_DATABASE_URL are required from the environment with no default,
#     so compose refuses to render — let alone start — if either is missing;
#   - api and db restart automatically (unless-stopped) so a host reboot brings the stack back.
# Supply the values from an env file, e.g. `--env-file .env.prod`; the full production posture
# (.env.prod.example) ships with the VPS bring-up slice.
services:
  db:
    # !reset drops the base file's "5432:5432" publish outright. A plain empty list would be
    # merged with the base list, not replace it.
    ports: !reset []
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?set POSTGRES_PASSWORD (no default in production)}
    restart: unless-stopped

  api:
    environment:
      MCA_DATABASE_URL: ${MCA_DATABASE_URL:?set MCA_DATABASE_URL (no default in production)}
    restart: unless-stopped
```

- [ ] **Step 4: Run to verify the test passes**

Run: `.venv/bin/python -m pytest tests/test_compose_prod_overlay.py -v`
Expected: PASS (3 tests). If the two render tests skip, the Docker CLI is missing locally — CI still
enforces them via Step 5.

- [ ] **Step 5: Add the CI docker-lane assertion**

In `.github/workflows/ci.yml`, replace the `docker` job (lines 70-73) with:

```yaml
  docker:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - run: docker build .
      - name: Production overlay renders without publishing Postgres
        env:
          POSTGRES_PASSWORD: ci-not-a-real-password
          MCA_DATABASE_URL: postgresql+psycopg://mca:ci-not-a-real-password@db:5432/mca
        run: |
          docker compose --env-file /dev/null \
            -f docker-compose.yml -f docker-compose.prod.yml config > rendered.yml
          ! grep -q 'published: "5432"' rendered.yml
          grep -q 'published: "8000"' rendered.yml
          test "$(grep -c 'restart: unless-stopped' rendered.yml)" = "2"
```

- [ ] **Step 6: Run the CI assertion locally (same commands)**

Run from the worktree root:

```bash
POSTGRES_PASSWORD=ci-not-a-real-password \
MCA_DATABASE_URL=postgresql+psycopg://mca:ci-not-a-real-password@db:5432/mca \
docker compose --env-file /dev/null -f docker-compose.yml -f docker-compose.prod.yml config \
  | grep -E 'published|restart'
```

Expected: `published: "8000"` and two `restart: unless-stopped` lines; **no** `published: "5432"`.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.prod.yml tests/test_compose_prod_overlay.py .github/workflows/ci.yml
git commit -m "feat(deploy): production compose overlay with no published db port"
```

---

## Task 7: Full gate

- [ ] **Step 1: Run `make test-all` from the worktree root**

Run: `make test-all`
Expected: green — pytest (backend, including the ~27 new tests), `ruff check .` clean, frontend
`npm test` green, `npm run build` succeeds. The frontend is untouched in this slice, so any frontend
failure is pre-existing; re-run on a clean checkout before investigating.

If `make test` reports a stale-shebang error, run the suite as
`.venv/bin/python -m pytest tests -q` and treat that as the pytest leg.

- [ ] **Step 2: Confirm the slice completion criteria**

From the spec, restated as a checklist — verify each before declaring the slice done:

- [ ] **1. Prod-like boot with a hosted key and the limiter off refuses to start; the same boot with
  the limiter on starts clean.** Covered by
  `tests/test_config_llm_guard.py::test_hosted_key_without_rate_limiting_refuses_to_boot` (all four
  key variables) and `::test_hosted_key_boots_when_rate_limiting_is_on`.
- [ ] **2. With a small test budget, the assistant turn is refused with the fixed message and makes
  no upstream call.** Covered by
  `tests/test_assistant_token_budget.py::test_turn_refuses_before_the_planning_call_when_the_budget_is_spent`
  (`complete_calls == 0`) and `::test_turn_refuses_before_narration_when_planning_spends_the_budget`
  (`stream_calls == 0`).
- [ ] **3. `docker compose -f docker-compose.yml -f docker-compose.prod.yml config` shows no
  published db port and no default password.** Covered by
  `tests/test_compose_prod_overlay.py::test_rendered_overlay_publishes_no_postgres_port` and
  `::test_rendered_overlay_refuses_to_render_without_a_db_password`, plus the CI docker-lane step.
- [ ] **4. `make test-all` green** (Step 1 above).
- [ ] **Invariant:** the budget-exhausted message is the only new user-facing string, and it names
  no place, address, neighborhood, or safety concept — pinned by
  `tests/test_assistant_token_budget.py::test_budget_message_stays_out_of_place_and_safety_vocabulary`.
  No guard or analysis behavior changed.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin p8-slice1-safety-rails
```

Open the PR (or hand back to the orchestrator, per the delivery workflow) with a body summarizing:
the boot guard, the daily token budget and where it is enforced, the two posture warnings, and the
prod compose overlay + CI render assertion.

---

## Out of scope (do not do here)

- Any frontend change. The budget refusal rides the existing SSE `error` rendering; no new UI copy.
- Redis or otherwise persistent counters — a restart resets the day's spend (accepted, single host).
- Per-session token budgets, billing integration, spend dashboards.
- `.env.prod.example`, VPS bring-up, reverse proxy, or TLS (slice 4).
- Any edit to `docker-compose.yml`, `docker-compose.demo.yml`, or the personal ThinkPad deploy path.
- Trust-surface / freshness work (slices 2 and 3).

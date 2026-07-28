"""The assistant command route must not block the event loop.

execute_tool is fully synchronous — sync DB work, sync httpx, and a geocoder that
time.sleep()s to hold its 1 req/s cadence. Awaiting it directly on the loop meant one
select_places with several address lookups froze the whole process: health checks,
static files, every other user's request.
"""

from __future__ import annotations

import asyncio
import time

import anyio
import httpx

import app.api.routes_assistant as routes_assistant
from app.main import create_app

_BLOCKING_SECONDS = 1.0


def _slow_execute_tool(session, user_id_hash, command, arguments):
    # Stands in for the real blocking work (sync geocode + sync DB).
    time.sleep(_BLOCKING_SECONDS)
    return {"tool_name": command, "arguments": {}, "result": {"followups": []}}


def test_health_stays_responsive_during_a_slow_command(tmp_path, monkeypatch):
    app = create_app(database_url=f"sqlite+pysqlite:///{tmp_path / 'loop.sqlite3'}")
    monkeypatch.setattr(routes_assistant, "execute_tool", _slow_execute_tool)

    async def scenario() -> float:
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
            await client.post("/sessions")

            async def slow_command():
                return await client.post(
                    "/assistant/commands", json={"command": "suggest_followups"}
                )

            async def health_probe() -> float:
                # Time the whole probe, including the sleep: a blocked loop cannot even
                # resume this coroutine, so the starvation shows up as sleep overshoot.
                # Measuring only the GET would start the clock after the block had ended.
                started = time.monotonic()
                await asyncio.sleep(0.15)
                response = await client.get("/health")
                assert response.status_code == 200
                return time.monotonic() - started

            command_response, probe_latency = await asyncio.gather(
                slow_command(), health_probe()
            )
            assert command_response.status_code == 200
            return probe_latency

    latency = anyio.run(scenario, backend="asyncio")

    # If execute_tool ran on the loop, /health could not be served until it returned.
    assert latency < _BLOCKING_SECONDS / 2, (
        f"/health took {latency:.3f}s while a command was running — the event loop was blocked"
    )

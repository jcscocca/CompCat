from __future__ import annotations

import json
from typing import Protocol

import httpx


class AssistantLlmClient(Protocol):
    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        ...


class LocalAgentUnavailable(RuntimeError):
    pass


class LocalAgentClient:
    def __init__(self, base_url: str, timeout_s: float = 120.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout_s = timeout_s

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        payload = {
            "role": role,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        try:
            async with httpx.AsyncClient(timeout=self.timeout_s) as client:
                async with client.stream(
                    "POST",
                    f"{self.base_url}/api/llm/stream",
                    json=payload,
                ) as response:
                    response.raise_for_status()
                    return await _collect_sse_text(response)
        except httpx.HTTPError as exc:
            raise LocalAgentUnavailable(f"LocalAgent unavailable: {exc}") from exc


async def _collect_sse_text(response: httpx.Response) -> str:
    event_name: str | None = None
    data_lines: list[str] = []
    output: list[str] = []

    def flush_event() -> None:
        if event_name == "token":
            payload = json.loads("\n".join(data_lines) or "{}")
            output.append(str(payload.get("delta", "")))
        elif event_name == "error":
            payload = json.loads("\n".join(data_lines) or "{}")
            raise LocalAgentUnavailable(str(payload.get("message") or "LocalAgent error"))

    async for line in response.aiter_lines():
        if not line:
            flush_event()
            event_name = None
            data_lines = []
            continue
        if line.startswith("event:"):
            event_name = line.split(":", 1)[1].strip()
        elif line.startswith("data:"):
            data_lines.append(line.split(":", 1)[1].strip())
    # Flush a trailing event when the stream closes without a final blank line.
    flush_event()
    return "".join(output)


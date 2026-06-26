from __future__ import annotations

import json
import logging
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)


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


class OpenAiLlmClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout_s: float = 120.0,
        connect_timeout_s: float = 5.0,
        extra_body: dict[str, object] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_s = timeout_s
        # A short connect timeout lets failover react quickly when an endpoint is
        # offline, while the longer read timeout still allows for model load and
        # generation latency once a connection is established.
        self.connect_timeout_s = connect_timeout_s
        # Extra payload fields merged into each request. Used to pass llama.cpp
        # options such as chat_template_kwargs={"enable_thinking": False}.
        self.extra_body = dict(extra_body or {})

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        # Spread extra_body first so the core fields below always win and can
        # never be clobbered by caller-supplied options.
        payload: dict[str, object] = {
            **self.extra_body,
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        timeout = httpx.Timeout(self.timeout_s, connect=self.connect_timeout_s)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(f"{self.base_url}/chat/completions", json=payload)
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise LocalAgentUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        try:
            content = data["choices"][0]["message"].get("content")
        except (KeyError, IndexError, TypeError) as exc:
            raise LocalAgentUnavailable(
                "LLM endpoint returned an unexpected response shape."
            ) from exc
        if not content or not content.strip():
            raise LocalAgentUnavailable(
                "LLM returned empty content (a reasoning model may have spent the token "
                "budget on reasoning_content — disable thinking or use an instruct model)."
            )
        return content


class FailoverLlmClient:
    """Try each underlying client in order, falling back to the next when one
    raises :class:`LocalAgentUnavailable` (offline endpoint, bad response shape,
    or empty content). Raises :class:`LocalAgentUnavailable` only when every
    client fails. Failover is decided per ``complete`` call, so a multi-step
    tool loop keeps working even if the primary drops mid-turn.
    """

    def __init__(self, clients: list[AssistantLlmClient]) -> None:
        if not clients:
            raise ValueError("FailoverLlmClient requires at least one client")
        self.clients = list(clients)

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        failures: list[str] = []
        last_exc: LocalAgentUnavailable | None = None
        for index, client in enumerate(self.clients):
            try:
                return await client.complete(
                    messages,
                    role=role,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except LocalAgentUnavailable as exc:
                label = getattr(client, "base_url", f"client[{index}]")
                failures.append(f"{label}: {exc}")
                last_exc = exc
                if index + 1 < len(self.clients):
                    next_label = getattr(
                        self.clients[index + 1], "base_url", f"client[{index + 1}]"
                    )
                    logger.warning(
                        "LLM endpoint %s unavailable (%s); failing over to %s",
                        label,
                        exc,
                        next_label,
                    )
        raise LocalAgentUnavailable(
            "All LLM endpoints failed: " + "; ".join(failures)
        ) from last_exc


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

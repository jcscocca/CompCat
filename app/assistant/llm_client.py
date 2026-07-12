from __future__ import annotations

import json
import logging
from collections.abc import AsyncIterator
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

    def stream(
        self,
        messages: list[dict[str, str]],
        *,
        role: str,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        ...


class LlmUnavailable(RuntimeError):
    pass


class LlmStreamInterrupted(RuntimeError):
    """A streaming completion died after emitting at least one delta. Not safe to
    fail over (the consumer already saw text); callers replace the partial answer."""


class OpenAiLlmClient:
    def __init__(
        self,
        base_url: str,
        model: str,
        timeout_s: float = 120.0,
        connect_timeout_s: float = 5.0,
        extra_body: dict[str, object] | None = None,
        api_key: str = "",
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
        # Bearer auth for hosted endpoints (Groq, etc.); empty for LAN llama-swap.
        self.api_key = api_key

    def request_headers(self) -> dict[str, str]:
        if self.api_key:
            return {"Authorization": f"Bearer {self.api_key}"}
        return {}

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
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    json=payload,
                    headers=self.request_headers(),
                )
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPError as exc:
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        try:
            content = data["choices"][0]["message"].get("content")
        except (KeyError, IndexError, TypeError) as exc:
            raise LlmUnavailable(
                "LLM endpoint returned an unexpected response shape."
            ) from exc
        if not content or not content.strip():
            raise LlmUnavailable(
                "LLM returned empty content (a reasoning model may have spent the token "
                "budget on reasoning_content — disable thinking or use an instruct model)."
            )
        return content

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
        }
        timeout = httpx.Timeout(self.timeout_s, connect=self.connect_timeout_s)
        yielded = False
        try:
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
                        try:
                            delta = chunk["choices"][0].get("delta") or {}
                        except (KeyError, IndexError, TypeError):
                            continue
                        content = delta.get("content")
                        if content:
                            yielded = True
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
        if not yielded:
            raise LlmUnavailable(
                "LLM returned an empty stream (a reasoning model may have spent the "
                "token budget on reasoning_content — disable thinking or use an "
                "instruct model)."
            )


class FailoverLlmClient:
    """Try each underlying client in order, falling back to the next when one
    raises :class:`LlmUnavailable` (offline endpoint, bad response shape,
    or empty content). Raises :class:`LlmUnavailable` only when every
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
        last_exc: LlmUnavailable | None = None
        for index, client in enumerate(self.clients):
            try:
                return await client.complete(
                    messages,
                    role=role,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except LlmUnavailable as exc:
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
        raise LlmUnavailable(
            "All LLM endpoints failed: " + "; ".join(failures)
        ) from last_exc

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        # LlmUnavailable is only raised by a client before its first delta (mid-stream
        # failures are LlmStreamInterrupted), so failing over here never repeats text.
        failures: list[str] = []
        last_exc: LlmUnavailable | None = None
        for index, client in enumerate(self.clients):
            try:
                async for delta in client.stream(
                    messages,
                    role=role,
                    temperature=temperature,
                    max_tokens=max_tokens,
                ):
                    yield delta
                return
            except LlmUnavailable as exc:
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
        raise LlmUnavailable(
            "All LLM endpoints failed: " + "; ".join(failures)
        ) from last_exc

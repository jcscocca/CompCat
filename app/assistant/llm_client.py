from __future__ import annotations

import asyncio
import contextlib
import json
import logging
from collections.abc import AsyncIterator
from typing import Protocol

import anthropic
import httpx
import openai

logger = logging.getLogger(__name__)

_ANTHROPIC_DEFAULT_MAX_TOKENS = 1024
_OPENAI_NATIVE_DEFAULT_MAX_TOKENS = 1024


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
        max_stream_seconds: float = 300.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout_s = timeout_s
        # Overall wall-clock budget for a streamed completion. The httpx read timeout only
        # bounds the gap *between* chunks, so an upstream dripping one token just under that
        # gap forever would hold the SSE connection open indefinitely; this caps the whole
        # stream. Generous — a normal narration finishes in a few seconds.
        self.max_stream_seconds = max_stream_seconds
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


def _split_anthropic_messages(
    messages: list[dict[str, str]],
) -> tuple[str, list[dict[str, str]]]:
    """Convert OpenAI-shaped messages to Anthropic's split form: system turns are hoisted
    out of the array (Anthropic takes them as a top-level ``system`` field), and any leading
    non-user turns are dropped so the array starts with ``user`` — the narration prompt sends
    ``[system, ...history..., user]`` and the history can begin with an assistant turn, which
    Anthropic rejects."""
    system_parts: list[str] = []
    converted: list[dict[str, str]] = []
    for message in messages:
        role = message.get("role", "")
        content = message.get("content", "")
        if role == "system":
            if content:
                system_parts.append(content)
        else:
            converted.append({"role": role, "content": content})
    while converted and converted[0]["role"] != "user":
        converted.pop(0)
    return "\n\n".join(system_parts), converted


def _anthropic_text(response: object) -> str:
    blocks = getattr(response, "content", None) or []
    return "".join(
        getattr(block, "text", "")
        for block in blocks
        if getattr(block, "type", None) == "text"
    )


class AnthropicLlmClient:
    """Claude backend for Tabby, honoring the same :class:`AssistantLlmClient` contract as
    :class:`OpenAiLlmClient` via the official Anthropic SDK. ``temperature`` is accepted but
    not forwarded — current Claude models reject non-default sampling parameters. Errors are
    mapped to :class:`LlmUnavailable` / :class:`LlmStreamInterrupted` so this composes with
    :class:`FailoverLlmClient` exactly like the OpenAI client."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        disable_thinking: bool = True,
        max_tokens_default: int = _ANTHROPIC_DEFAULT_MAX_TOKENS,
        timeout_s: float = 120.0,
        connect_timeout_s: float = 5.0,
        client: object | None = None,
    ) -> None:
        self.model = model
        self.api_key = api_key
        # A base_url-shaped label so FailoverLlmClient's failover log lines name this backend.
        self.base_url = f"anthropic:{model}"
        self._disable_thinking = disable_thinking
        self._max_tokens_default = max_tokens_default
        self._timeout = httpx.Timeout(timeout_s, connect=connect_timeout_s)
        # Built lazily on first use so construction stays cheap and loop-free; tests inject a fake.
        self._client = client

    def _ensure_client(self):
        if self._client is None:
            self._client = anthropic.AsyncAnthropic(api_key=self.api_key, timeout=self._timeout)
        return self._client

    def _request_kwargs(
        self, messages: list[dict[str, str]], max_tokens: int | None
    ) -> dict[str, object]:
        system, converted = _split_anthropic_messages(messages)
        kwargs: dict[str, object] = {
            "model": self.model,
            "max_tokens": max_tokens or self._max_tokens_default,
            "messages": converted,
        }
        if system:
            kwargs["system"] = system
        if self._disable_thinking:
            # Claude models (e.g. Sonnet 5) run adaptive thinking by default, and thinking
            # tokens count against max_tokens — which the agent caps tightly (256 for
            # narration). Off by default so the budget goes to the answer, not to reasoning.
            kwargs["thinking"] = {"type": "disabled"}
        return kwargs

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        try:
            response = await self._ensure_client().messages.create(
                **self._request_kwargs(messages, max_tokens)
            )
        except anthropic.APIError as exc:
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        content = _anthropic_text(response)
        if not content or not content.strip():
            raise LlmUnavailable(
                "LLM returned empty content (the model may have refused or spent its token "
                "budget on reasoning)."
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
        yielded = False
        try:
            async with self._ensure_client().messages.stream(
                **self._request_kwargs(messages, max_tokens)
            ) as stream:
                async for text in stream.text_stream:
                    if text:
                        yielded = True
                        yield text
        except Exception as exc:  # API, transport, or decode failure — degrade uniformly
            if yielded:
                raise LlmStreamInterrupted(
                    f"LLM stream died mid-generation: {exc}"
                ) from exc
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        if not yielded:
            raise LlmUnavailable(
                "LLM returned an empty stream (the model may have refused or produced no text)."
            )


def _openai_message_text(response: object) -> str:
    choices = getattr(response, "choices", None) or []
    if not choices:
        return ""
    message = getattr(choices[0], "message", None)
    return getattr(message, "content", None) or ""


def _openai_delta_text(chunk: object) -> str:
    choices = getattr(chunk, "choices", None) or []
    if not choices:
        return ""
    delta = getattr(choices[0], "delta", None)
    return getattr(delta, "content", None) or ""


class OpenAiNativeLlmClient:
    """First-class OpenAI backend using the official ``openai`` SDK — native auth, built-in
    retries, and typed errors. Distinct from :class:`OpenAiLlmClient`, which is a generic
    /chat/completions HTTP client for any OpenAI-compatible host (local llama-swap, Groq, …).
    OpenAI takes ``system`` in the messages array and accepts ``temperature``, so messages pass
    through unchanged. Errors map to :class:`LlmUnavailable` / :class:`LlmStreamInterrupted` so
    this composes with :class:`FailoverLlmClient` like the other backends."""

    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        base_url: str = "",
        send_temperature: bool = True,
        max_tokens_default: int = _OPENAI_NATIVE_DEFAULT_MAX_TOKENS,
        timeout_s: float = 120.0,
        connect_timeout_s: float = 5.0,
        client: object | None = None,
    ) -> None:
        self.model = model
        self.api_key = api_key
        self.base_url = base_url or "https://api.openai.com/v1"
        self._send_temperature = send_temperature
        self._max_tokens_default = max_tokens_default
        self._timeout = httpx.Timeout(timeout_s, connect=connect_timeout_s)
        # Built lazily on first use so construction stays cheap and loop-free; tests inject a fake.
        self._client = client

    def _ensure_client(self):
        if self._client is None:
            self._client = openai.AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url,
                timeout=self._timeout,
            )
        return self._client

    def _request_kwargs(
        self,
        messages: list[dict[str, str]],
        temperature: float | None,
        max_tokens: int | None,
        *,
        stream: bool,
    ) -> dict[str, object]:
        kwargs: dict[str, object] = {
            "model": self.model,
            "messages": messages,
            # max_completion_tokens (not the deprecated max_tokens) so current OpenAI chat
            # models — including reasoning models — accept it.
            "max_completion_tokens": max_tokens or self._max_tokens_default,
        }
        if self._send_temperature and temperature is not None:
            kwargs["temperature"] = temperature
        if stream:
            kwargs["stream"] = True
        return kwargs

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        try:
            response = await self._ensure_client().chat.completions.create(
                **self._request_kwargs(messages, temperature, max_tokens, stream=False)
            )
        except openai.APIError as exc:
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        content = _openai_message_text(response)
        if not content or not content.strip():
            raise LlmUnavailable("LLM returned empty content.")
        return content

    async def stream(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> AsyncIterator[str]:
        yielded = False
        try:
            chunks = await self._ensure_client().chat.completions.create(
                **self._request_kwargs(messages, temperature, max_tokens, stream=True)
            )
            # async with so an abandoned generator (disconnect, guard trip) closes the SDK
            # stream instead of leaking the connection and server-side generation.
            async with chunks:
                async for chunk in chunks:
                    text = _openai_delta_text(chunk)
                    if text:
                        yielded = True
                        yield text
        except Exception as exc:  # API, transport, or decode failure — degrade uniformly
            if yielded:
                raise LlmStreamInterrupted(
                    f"LLM stream died mid-generation: {exc}"
                ) from exc
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        if not yielded:
            raise LlmUnavailable("LLM returned an empty stream.")


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
        yielded = False
        for index, client in enumerate(self.clients):
            try:
                async with contextlib.aclosing(
                    client.stream(
                        messages,
                        role=role,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
                ) as inner:
                    async for delta in inner:
                        yielded = True
                        yield delta
                return
            except LlmUnavailable as exc:
                if yielded:
                    # Contract violation (LlmUnavailable after a delta): failing over
                    # would repeat text, so re-raise and let the caller replace the
                    # partial answer instead.
                    raise
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

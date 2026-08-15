from __future__ import annotations

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

logger = logging.getLogger(__name__)

_ANTHROPIC_DEFAULT_MAX_TOKENS = 1024
_OPENAI_NATIVE_DEFAULT_MAX_TOKENS = 1024


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


class LlmRateLimited(LlmUnavailable):
    """The upstream model provider rejected the request at its usage limit."""


class LlmQuotaExhausted(LlmRateLimited):
    """The provider rejected the request because its paid allowance is exhausted."""


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
        include_stream_usage: bool = False,
        supports_structured_output: bool = False,
        structured_extra_body: dict[str, object] | None = None,
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
        # Only ask for the trailing usage frame when a token budget is configured — the
        # request stays byte-identical to pre-budget behavior for hosts that might 400 on
        # unknown fields (LAN llama-swap).
        self.include_stream_usage = include_stream_usage
        # Structured planning is opt-in because generic OpenAI-compatible hosts vary in their
        # response_format support. The builder enables it only for a known-compatible backend.
        self.supports_structured_output = supports_structured_output
        # Per-planning overrides for providers where classification benefits from more
        # reasoning than narration. Applied only by complete_structured().
        self.structured_extra_body = dict(structured_extra_body or {})

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
        return await self._complete(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def complete_structured(
        self,
        messages: list[dict[str, str]],
        *,
        response_format: dict[str, object],
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Request structured output when this endpoint is known to support it."""
        return await self._complete(
            messages,
            temperature=temperature,
            max_tokens=max_tokens,
            response_format=response_format if self.supports_structured_output else None,
            request_extra_body=self.structured_extra_body,
        )

    async def _complete(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float | None,
        max_tokens: int | None,
        response_format: dict[str, object] | None = None,
        request_extra_body: dict[str, object] | None = None,
    ) -> str:
        # Spread extra_body first so the core fields below always win and can
        # never be clobbered by caller-supplied options.
        payload: dict[str, object] = {
            **self.extra_body,
            **(request_extra_body or {}),
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "stream": False,
        }
        if response_format is not None:
            payload["response_format"] = response_format
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
            raise _http_llm_error(exc) from exc
        try:
            choice = data["choices"][0]
            content = choice["message"].get("content")
        except (AttributeError, KeyError, IndexError, TypeError) as exc:
            raise LlmUnavailable(
                "LLM endpoint returned an unexpected response shape."
            ) from exc
        record_llm_tokens(messages, content or "", data.get("usage"))
        if choice.get("finish_reason") == "length":
            raise LlmUnavailable("LLM response was truncated at the configured token limit.")
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
        if self.include_stream_usage:
            # Trailing usage frame so the daily token budget counts real tokens; hosts that
            # ignore the option fall back to the chars/4 estimate below.
            payload["stream_options"] = {"include_usage": True}
        timeout = httpx.Timeout(self.timeout_s, connect=self.connect_timeout_s)
        yielded = False
        reached = False
        usage: dict[str, object] | None = None
        parts: list[str] = []
        truncated = False
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
                        reached = True
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
                                choice = chunk["choices"][0]
                                delta = choice.get("delta") or {}
                            except (AttributeError, KeyError, IndexError, TypeError):
                                continue
                            if choice.get("finish_reason") == "length":
                                truncated = True
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
            raise _http_llm_error(exc) from exc
        except Exception as exc:  # non-HTTP transport/decode oddities degrade the same way
            if yielded:
                raise LlmStreamInterrupted(
                    f"LLM stream died mid-generation: {exc}"
                ) from exc
            raise LlmUnavailable(f"LLM endpoint unavailable: {exc}") from exc
        finally:
            # Also runs on aclose() (output-guard trip, client disconnect), so an abandoned
            # narration still spends what it generated. A request that never reached the
            # provider (connect failure, non-2xx) charges nothing — failover would otherwise
            # bill the dead endpoint's prompt on every turn.
            if reached:
                record_llm_tokens(messages, "".join(parts), usage)
        if truncated:
            if yielded:
                raise LlmStreamInterrupted(
                    "LLM stream was truncated at the configured token limit."
                )
            raise LlmUnavailable("LLM stream was truncated at the configured token limit.")
        if not yielded:
            raise LlmUnavailable(
                "LLM returned an empty stream (a reasoning model may have spent the "
                "token budget on reasoning_content — disable thinking or use an "
                "instruct model)."
            )


def _http_llm_error(exc: httpx.HTTPError) -> LlmUnavailable:
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429:
        return LlmRateLimited("LLM provider rate limit reached.")
    return LlmUnavailable(f"LLM endpoint unavailable: {exc}")


def _sdk_error_code(exc: Exception) -> str:
    """Return a normalized vendor error code from an SDK exception body, when present."""
    body = getattr(exc, "body", None)
    if not isinstance(body, dict):
        return ""
    nested = body.get("error")
    error = nested if isinstance(nested, dict) else body
    code = error.get("code")
    return code.strip().lower() if isinstance(code, str) else ""


def _sdk_llm_error(
    exc: Exception,
    *,
    rate_limit_type: type[Exception],
) -> LlmUnavailable:
    """Map typed SDK failures onto the backend-independent assistant contract.

    SDKs normally use ``RateLimitError`` for HTTP 429, while the status-code check keeps
    the classification correct for compatible SDK versions that surface a generic status
    error instead. OpenAI also uses 429 for ``insufficient_quota``; preserve that separately
    so the user is not told a billing condition should clear in a minute.
    """
    is_rate_limit = isinstance(exc, rate_limit_type) or getattr(exc, "status_code", None) == 429
    if is_rate_limit:
        if _sdk_error_code(exc) == "insufficient_quota":
            return LlmQuotaExhausted(f"LLM provider quota exhausted: {exc}")
        return LlmRateLimited(f"LLM provider rate limit reached: {exc}")
    return LlmUnavailable(f"LLM endpoint unavailable: {exc}")


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
            raise _sdk_llm_error(exc, rate_limit_type=anthropic.RateLimitError) from exc
        content = _anthropic_text(response)
        record_llm_tokens(messages, content, getattr(response, "usage", None))
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
        reached = False
        usage: object | None = None
        parts: list[str] = []
        try:
            async with self._ensure_client().messages.stream(
                **self._request_kwargs(messages, max_tokens)
            ) as stream:
                reached = True
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
            raise _sdk_llm_error(exc, rate_limit_type=anthropic.RateLimitError) from exc
        finally:
            # Also runs on aclose() (output-guard trip, client disconnect), where usage is still
            # None and the chars/4 estimate charges what was generated. Never-connected
            # requests charge nothing.
            if reached:
                record_llm_tokens(messages, "".join(parts), usage)
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
            # Trailing usage chunk for the daily token budget; harmless when a proxy drops it.
            kwargs["stream_options"] = {"include_usage": True}
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
            raise _sdk_llm_error(exc, rate_limit_type=openai.RateLimitError) from exc
        content = _openai_message_text(response)
        record_llm_tokens(messages, content, getattr(response, "usage", None))
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
        reached = False
        usage: object | None = None
        parts: list[str] = []
        try:
            chunks = await self._ensure_client().chat.completions.create(
                **self._request_kwargs(messages, temperature, max_tokens, stream=True)
            )
            reached = True
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
            raise _sdk_llm_error(exc, rate_limit_type=openai.RateLimitError) from exc
        finally:
            # Also runs on aclose() (output-guard trip, client disconnect). Never-connected
            # requests charge nothing.
            if reached:
                record_llm_tokens(messages, "".join(parts), usage)
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
        saw_rate_limit = False
        saw_quota_exhausted = False
        for index, client in enumerate(self.clients):
            try:
                return await client.complete(
                    messages,
                    role=role,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except LlmUnavailable as exc:
                saw_rate_limit = saw_rate_limit or isinstance(exc, LlmRateLimited)
                saw_quota_exhausted = saw_quota_exhausted or isinstance(
                    exc, LlmQuotaExhausted
                )
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
        raise _failover_error(failures, saw_rate_limit, saw_quota_exhausted) from last_exc

    async def complete_structured(
        self,
        messages: list[dict[str, str]],
        *,
        response_format: dict[str, object],
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        """Preserve structured planning on capable endpoints while retaining failover."""
        failures: list[str] = []
        last_exc: LlmUnavailable | None = None
        saw_rate_limit = False
        saw_quota_exhausted = False
        for index, client in enumerate(self.clients):
            try:
                structured_complete = getattr(client, "complete_structured", None)
                if callable(structured_complete):
                    return await structured_complete(
                        messages,
                        response_format=response_format,
                        role=role,
                        temperature=temperature,
                        max_tokens=max_tokens,
                    )
                return await client.complete(
                    messages,
                    role=role,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
            except LlmUnavailable as exc:
                saw_rate_limit = saw_rate_limit or isinstance(exc, LlmRateLimited)
                saw_quota_exhausted = saw_quota_exhausted or isinstance(
                    exc, LlmQuotaExhausted
                )
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
        raise _failover_error(failures, saw_rate_limit, saw_quota_exhausted) from last_exc

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
        saw_rate_limit = False
        saw_quota_exhausted = False
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
                saw_rate_limit = saw_rate_limit or isinstance(exc, LlmRateLimited)
                saw_quota_exhausted = saw_quota_exhausted or isinstance(
                    exc, LlmQuotaExhausted
                )
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
        raise _failover_error(failures, saw_rate_limit, saw_quota_exhausted) from last_exc


def _failover_error(
    failures: list[str], saw_rate_limit: bool, saw_quota_exhausted: bool
) -> LlmUnavailable:
    error_type = (
        LlmQuotaExhausted
        if saw_quota_exhausted
        else LlmRateLimited
        if saw_rate_limit
        else LlmUnavailable
    )
    return error_type("All LLM endpoints failed: " + "; ".join(failures))

from __future__ import annotations

import asyncio
from types import SimpleNamespace

import httpx
import openai
import pytest

from app.assistant.llm_client import (
    LlmQuotaExhausted,
    LlmRateLimited,
    LlmStreamInterrupted,
    LlmUnavailable,
    OpenAiNativeLlmClient,
)
from app.ratelimit import get_rate_limiter

_DUMMY_REQUEST = httpx.Request("POST", "https://api.openai.com/v1/chat/completions")


def _api_status_error(
    error_type: type[openai.APIStatusError] = openai.RateLimitError,
    *,
    code: str = "rate_limit_exceeded",
) -> openai.APIStatusError:
    body = {"message": "provider limit", "type": "requests", "code": code}
    response = httpx.Response(429, request=_DUMMY_REQUEST, json={"error": body})
    return error_type("provider limit", response=response, body=body)


def _resp(content: str | None):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=content))])


def _resp_with_usage(content: str, usage: object):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))], usage=usage
    )


def _chunk(content: str | None):
    return SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content=content))])


_EMPTY_CHOICES_CHUNK = SimpleNamespace(choices=[])


class _FakeStream:
    """Stands in for the AsyncStream that `create(stream=True)` resolves to."""

    def __init__(
        self,
        chunks: list[object],
        *,
        error_after: int | None = None,
        iter_exc: Exception | None = None,
    ) -> None:
        self._chunks = chunks
        self._error_after = error_after
        self._iter_exc = iter_exc
        self.closed = False

    async def __aenter__(self) -> _FakeStream:
        return self

    async def __aexit__(self, *exc: object) -> bool:
        self.closed = True
        return False

    def __aiter__(self):
        return self._agen()

    async def _agen(self):
        for index, chunk in enumerate(self._chunks):
            if self._error_after is not None and index == self._error_after:
                raise self._iter_exc or httpx.ReadError("dropped")
            yield chunk


class _FakeCompletions:
    def __init__(
        self,
        *,
        response: object | None = None,
        create_exc: Exception | None = None,
        stream: _FakeStream | None = None,
    ) -> None:
        self._response = response
        self._create_exc = create_exc
        self._stream = stream
        self.captured: dict[str, object] = {}

    async def create(self, **kwargs: object):
        self.captured = dict(kwargs)
        if self._create_exc is not None:
            raise self._create_exc
        if kwargs.get("stream"):
            assert self._stream is not None
            return self._stream
        assert self._response is not None
        return self._response


def _client(completions: _FakeCompletions) -> OpenAiNativeLlmClient:
    fake = SimpleNamespace(chat=SimpleNamespace(completions=completions))
    return OpenAiNativeLlmClient(api_key="test", model="gpt-4o", client=fake)


def _collect(client: OpenAiNativeLlmClient, messages: list[dict[str, str]], **kw) -> list[str]:
    async def run() -> list[str]:
        return [delta async for delta in client.stream(messages, **kw)]

    return asyncio.run(run())


# ---------- complete() ----------


def test_complete_returns_message_content() -> None:
    comp = _FakeCompletions(response=_resp("hello"))
    out = asyncio.run(_client(comp).complete([{"role": "user", "content": "hi"}]))
    assert out == "hello"


def test_complete_empty_content_raises_unavailable() -> None:
    comp = _FakeCompletions(response=_resp("   "))
    with pytest.raises(LlmUnavailable, match="empty content"):
        asyncio.run(_client(comp).complete([{"role": "user", "content": "hi"}]))


def test_complete_none_content_raises_unavailable() -> None:
    comp = _FakeCompletions(response=_resp(None))
    with pytest.raises(LlmUnavailable, match="empty content"):
        asyncio.run(_client(comp).complete([{"role": "user", "content": "hi"}]))


def test_complete_api_error_raises_unavailable() -> None:
    comp = _FakeCompletions(create_exc=openai.APIConnectionError(request=_DUMMY_REQUEST))
    with pytest.raises(LlmUnavailable, match="unavailable"):
        asyncio.run(_client(comp).complete([{"role": "user", "content": "hi"}]))


def test_complete_rate_limit_error_raises_rate_limited() -> None:
    comp = _FakeCompletions(create_exc=_api_status_error())
    with pytest.raises(LlmRateLimited, match="provider limit"):
        asyncio.run(_client(comp).complete([{"role": "user", "content": "hi"}]))


def test_complete_generic_429_status_raises_rate_limited() -> None:
    comp = _FakeCompletions(create_exc=_api_status_error(openai.APIStatusError))
    with pytest.raises(LlmRateLimited, match="provider limit"):
        asyncio.run(_client(comp).complete([{"role": "user", "content": "hi"}]))


def test_complete_insufficient_quota_has_distinct_classification() -> None:
    comp = _FakeCompletions(create_exc=_api_status_error(code="insufficient_quota"))
    with pytest.raises(LlmQuotaExhausted, match="quota exhausted"):
        asyncio.run(_client(comp).complete([{"role": "user", "content": "hi"}]))


def test_complete_forwards_messages_temperature_and_model() -> None:
    comp = _FakeCompletions(response=_resp("ok"))
    # OpenAI takes system in the messages array as-is — no hoisting like the Anthropic path.
    messages = [{"role": "system", "content": "SYS"}, {"role": "user", "content": "hi"}]
    asyncio.run(_client(comp).complete(messages, temperature=0.2, max_tokens=512))
    assert comp.captured["messages"] == messages
    assert comp.captured["model"] == "gpt-4o"
    assert comp.captured["temperature"] == 0.2
    # max_completion_tokens (not the deprecated max_tokens) so reasoning models also accept it.
    assert comp.captured["max_completion_tokens"] == 512
    assert "max_tokens" not in comp.captured


# ---------- stream() ----------


def test_stream_yields_content_deltas() -> None:
    comp = _FakeCompletions(
        stream=_FakeStream([_chunk("Hel"), _EMPTY_CHOICES_CHUNK, _chunk(None), _chunk("lo")])
    )
    assert _collect(_client(comp), [{"role": "user", "content": "hi"}]) == ["Hel", "lo"]


def test_stream_empty_raises_unavailable() -> None:
    comp = _FakeCompletions(stream=_FakeStream([]))
    with pytest.raises(LlmUnavailable, match="empty stream"):
        _collect(_client(comp), [{"role": "user", "content": "hi"}])


def test_stream_pre_delta_error_raises_unavailable() -> None:
    comp = _FakeCompletions(create_exc=openai.APIConnectionError(request=_DUMMY_REQUEST))
    with pytest.raises(LlmUnavailable, match="unavailable"):
        _collect(_client(comp), [{"role": "user", "content": "hi"}])


def test_stream_pre_delta_rate_limit_raises_rate_limited() -> None:
    comp = _FakeCompletions(create_exc=_api_status_error())
    with pytest.raises(LlmRateLimited, match="provider limit"):
        _collect(_client(comp), [{"role": "user", "content": "hi"}])


def test_stream_mid_stream_death_raises_interrupted() -> None:
    comp = _FakeCompletions(
        stream=_FakeStream(
            [_chunk("partial"), _chunk("x")], error_after=1, iter_exc=httpx.ReadError("drop")
        )
    )
    with pytest.raises(LlmStreamInterrupted):
        _collect(_client(comp), [{"role": "user", "content": "hi"}])


def test_stream_sets_stream_true_and_forwards_temperature() -> None:
    comp = _FakeCompletions(stream=_FakeStream([_chunk("ok")]))
    _collect(
        _client(comp),
        [{"role": "user", "content": "hi"}],
        temperature=0.4,
        max_tokens=256,
    )
    assert comp.captured["stream"] is True
    assert comp.captured["temperature"] == 0.4
    assert comp.captured["max_completion_tokens"] == 256


def test_stream_closes_underlying_stream_on_early_abandonment() -> None:
    # A closed generator (client disconnect, or the narration output-guard trip) must close
    # the SDK stream so the connection and server-side generation don't linger.
    stream = _FakeStream([_chunk("a"), _chunk("b"), _chunk("c")])
    comp = _FakeCompletions(stream=stream)

    async def run() -> None:
        gen = _client(comp).stream([{"role": "user", "content": "hi"}])
        assert await gen.__anext__() == "a"
        await gen.aclose()

    asyncio.run(run())
    assert stream.closed is True


def test_temperature_suppressed_for_reasoning_models() -> None:
    # send_temperature=False lets an operator target o-series/gpt-5 models, which reject
    # a non-default temperature.
    comp = _FakeCompletions(response=_resp("ok"))
    fake = SimpleNamespace(chat=SimpleNamespace(completions=comp))
    client = OpenAiNativeLlmClient(
        api_key="test", model="o4-mini", send_temperature=False, client=fake
    )
    asyncio.run(client.complete([{"role": "user", "content": "hi"}], temperature=0.2))
    assert "temperature" not in comp.captured


def test_luna_regular_completion_uses_explicit_none_reasoning() -> None:
    comp = _FakeCompletions(response=_resp("ok"))
    fake = SimpleNamespace(chat=SimpleNamespace(completions=comp))
    client = OpenAiNativeLlmClient(
        api_key="test",
        model="gpt-5.6-luna",
        send_temperature=False,
        reasoning_effort="none",
        structured_reasoning_effort="medium",
        supports_structured_output=True,
        client=fake,
    )

    asyncio.run(
        client.complete(
            [{"role": "user", "content": "hi"}], temperature=0.2, max_tokens=512
        )
    )

    assert comp.captured["reasoning_effort"] == "none"
    assert "temperature" not in comp.captured


def test_luna_structured_completion_uses_json_mode_and_medium_reasoning() -> None:
    comp = _FakeCompletions(response=_resp('{"type":"final","message":"ok"}'))
    fake = SimpleNamespace(chat=SimpleNamespace(completions=comp))
    client = OpenAiNativeLlmClient(
        api_key="test",
        model="gpt-5.6-luna",
        send_temperature=False,
        reasoning_effort="none",
        structured_reasoning_effort="medium",
        supports_structured_output=True,
        client=fake,
    )
    response_format = {"type": "json_object"}

    result = asyncio.run(
        client.complete_structured(
            [{"role": "user", "content": "return JSON"}],
            response_format=response_format,
            temperature=0.2,
            max_tokens=1024,
        )
    )

    assert result == '{"type":"final","message":"ok"}'
    assert comp.captured["response_format"] == response_format
    assert comp.captured["reasoning_effort"] == "medium"
    assert "temperature" not in comp.captured


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

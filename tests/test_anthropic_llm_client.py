from __future__ import annotations

import asyncio
from types import SimpleNamespace

import anthropic
import httpx
import pytest

from app.assistant.llm_client import (
    AnthropicLlmClient,
    LlmStreamInterrupted,
    LlmUnavailable,
)

_DUMMY_REQUEST = httpx.Request("POST", "https://api.anthropic.com/v1/messages")


class _Block:
    def __init__(self, type_: str, text: str = "") -> None:
        self.type = type_
        self.text = text


class _Response:
    def __init__(self, blocks: list[_Block]) -> None:
        self.content = blocks


class _StreamCtx:
    """Stands in for the async-context object returned by messages.stream()."""

    def __init__(
        self,
        texts: list[str],
        *,
        enter_exc: Exception | None = None,
        iter_exc: Exception | None = None,
        error_after: int | None = None,
    ) -> None:
        self._texts = texts
        self._enter_exc = enter_exc
        self._iter_exc = iter_exc
        self._error_after = error_after

    async def __aenter__(self) -> _StreamCtx:
        if self._enter_exc is not None:
            raise self._enter_exc
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    @property
    def text_stream(self):
        return self._agen()

    async def _agen(self):
        for index, text in enumerate(self._texts):
            if self._error_after is not None and index == self._error_after:
                raise self._iter_exc or httpx.ReadError("dropped")
            yield text


class _FakeMessages:
    def __init__(
        self,
        *,
        response: _Response | None = None,
        create_exc: Exception | None = None,
        stream_ctx: _StreamCtx | None = None,
    ) -> None:
        self._response = response
        self._create_exc = create_exc
        self._stream_ctx = stream_ctx
        self.captured: dict[str, object] = {}

    async def create(self, **kwargs: object) -> _Response:
        self.captured = dict(kwargs)
        if self._create_exc is not None:
            raise self._create_exc
        assert self._response is not None
        return self._response

    def stream(self, **kwargs: object) -> _StreamCtx:
        self.captured = dict(kwargs)
        assert self._stream_ctx is not None
        return self._stream_ctx


def _client(messages: _FakeMessages) -> AnthropicLlmClient:
    return AnthropicLlmClient(
        api_key="test",
        model="claude-sonnet-5",
        client=SimpleNamespace(messages=messages),
    )


def _collect(client: AnthropicLlmClient, messages: list[dict[str, str]], **kw) -> list[str]:
    async def run() -> list[str]:
        return [delta async for delta in client.stream(messages, **kw)]

    return asyncio.run(run())


# ---------- complete() ----------


def test_complete_concatenates_text_blocks() -> None:
    msgs = _FakeMessages(
        response=_Response([_Block("text", "Hel"), _Block("thinking", "x"), _Block("text", "lo")])
    )
    out = asyncio.run(_client(msgs).complete([{"role": "user", "content": "hi"}]))
    assert out == "Hello"


def test_complete_empty_text_raises_unavailable() -> None:
    msgs = _FakeMessages(response=_Response([_Block("text", "   ")]))
    with pytest.raises(LlmUnavailable, match="empty content"):
        asyncio.run(_client(msgs).complete([{"role": "user", "content": "hi"}]))


def test_complete_api_error_raises_unavailable() -> None:
    msgs = _FakeMessages(create_exc=anthropic.APIConnectionError(request=_DUMMY_REQUEST))
    with pytest.raises(LlmUnavailable, match="unavailable"):
        asyncio.run(_client(msgs).complete([{"role": "user", "content": "hi"}]))


def test_complete_hoists_system_and_drops_temperature() -> None:
    msgs = _FakeMessages(response=_Response([_Block("text", "ok")]))
    asyncio.run(
        _client(msgs).complete(
            [{"role": "system", "content": "SYS"}, {"role": "user", "content": "hi"}],
            temperature=0.2,
            max_tokens=512,
        )
    )
    assert msgs.captured["system"] == "SYS"
    assert msgs.captured["messages"] == [{"role": "user", "content": "hi"}]
    assert msgs.captured["max_tokens"] == 512
    assert msgs.captured["model"] == "claude-sonnet-5"
    assert "temperature" not in msgs.captured


def test_complete_strips_leading_assistant_turn() -> None:
    # Narration sends [system, ...history..., user]; after the system hoist the array can
    # start with an assistant turn, which Anthropic rejects. It must be dropped.
    msgs = _FakeMessages(response=_Response([_Block("text", "ok")]))
    asyncio.run(
        _client(msgs).complete(
            [
                {"role": "system", "content": "S"},
                {"role": "assistant", "content": "prev"},
                {"role": "user", "content": "now"},
            ]
        )
    )
    assert msgs.captured["messages"] == [{"role": "user", "content": "now"}]


# ---------- stream() ----------


def test_stream_yields_text_deltas() -> None:
    msgs = _FakeMessages(stream_ctx=_StreamCtx(["Hel", "", "lo"]))
    assert _collect(_client(msgs), [{"role": "user", "content": "hi"}]) == ["Hel", "lo"]


def test_stream_empty_raises_unavailable() -> None:
    msgs = _FakeMessages(stream_ctx=_StreamCtx([]))
    with pytest.raises(LlmUnavailable, match="empty stream"):
        _collect(_client(msgs), [{"role": "user", "content": "hi"}])


def test_stream_pre_delta_error_raises_unavailable() -> None:
    msgs = _FakeMessages(
        stream_ctx=_StreamCtx([], enter_exc=anthropic.APIConnectionError(request=_DUMMY_REQUEST))
    )
    with pytest.raises(LlmUnavailable, match="unavailable"):
        _collect(_client(msgs), [{"role": "user", "content": "hi"}])


def test_stream_mid_stream_death_raises_interrupted() -> None:
    msgs = _FakeMessages(
        stream_ctx=_StreamCtx(["partial", "x"], error_after=1, iter_exc=httpx.ReadError("drop"))
    )
    with pytest.raises(LlmStreamInterrupted):
        _collect(_client(msgs), [{"role": "user", "content": "hi"}])


def test_stream_hoists_system_and_omits_temperature() -> None:
    msgs = _FakeMessages(stream_ctx=_StreamCtx(["ok"]))
    _collect(
        _client(msgs),
        [{"role": "system", "content": "SYS"}, {"role": "user", "content": "hi"}],
        temperature=0.4,
        max_tokens=256,
    )
    assert msgs.captured["system"] == "SYS"
    assert msgs.captured["messages"] == [{"role": "user", "content": "hi"}]
    assert msgs.captured["max_tokens"] == 256
    assert "temperature" not in msgs.captured


# ---------- thinking (defaults off so it can't eat the tight max_tokens budget) ----------


def test_complete_disables_thinking_by_default() -> None:
    msgs = _FakeMessages(response=_Response([_Block("text", "ok")]))
    asyncio.run(_client(msgs).complete([{"role": "user", "content": "hi"}]))
    assert msgs.captured["thinking"] == {"type": "disabled"}


def test_stream_disables_thinking_by_default() -> None:
    msgs = _FakeMessages(stream_ctx=_StreamCtx(["ok"]))
    _collect(_client(msgs), [{"role": "user", "content": "hi"}])
    assert msgs.captured["thinking"] == {"type": "disabled"}


def test_thinking_can_be_re_enabled() -> None:
    # Needed for claude-fable-5, which 400s on an explicit thinking:disabled.
    msgs = _FakeMessages(response=_Response([_Block("text", "ok")]))
    client = AnthropicLlmClient(
        api_key="test",
        model="claude-fable-5",
        disable_thinking=False,
        client=SimpleNamespace(messages=msgs),
    )
    asyncio.run(client.complete([{"role": "user", "content": "hi"}]))
    assert "thinking" not in msgs.captured

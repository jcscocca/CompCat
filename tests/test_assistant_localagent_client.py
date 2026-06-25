from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import pytest

from app.assistant.localagent_client import LocalAgentUnavailable, _collect_sse_text


class _FakeResponse:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines

    async def aiter_lines(self) -> AsyncIterator[str]:
        for line in self._lines:
            yield line


def test_collect_sse_text_flushes_final_token_without_trailing_blank_line():
    response = _FakeResponse(
        [
            "event: token",
            'data: {"delta": "Hello"}',
            "",
            "event: token",
            'data: {"delta": " world"}',
        ]
    )

    assert asyncio.run(_collect_sse_text(response)) == "Hello world"


def test_collect_sse_text_does_not_double_emit_with_trailing_blank_line():
    response = _FakeResponse(
        [
            "event: token",
            'data: {"delta": "Hello"}',
            "",
        ]
    )

    assert asyncio.run(_collect_sse_text(response)) == "Hello"


def test_collect_sse_text_raises_on_trailing_error_event():
    response = _FakeResponse(
        [
            "event: error",
            'data: {"message": "boom"}',
        ]
    )

    with pytest.raises(LocalAgentUnavailable, match="boom"):
        asyncio.run(_collect_sse_text(response))

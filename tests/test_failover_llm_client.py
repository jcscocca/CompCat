from __future__ import annotations

import asyncio
import contextlib
import logging

import pytest

from app.assistant import llm_client
from app.assistant.llm_client import FailoverLlmClient, LlmUnavailable

_MESSAGES = [{"role": "user", "content": "hi"}]


@contextlib.contextmanager
def _capture_failover_logs():
    """Capture WARNING records from the failover logger directly, independent of
    global logging configuration (robust to test-suite ordering). Other tests may
    have run a dictConfig with disable_existing_loggers or a logging.disable(),
    so reset both for the duration."""
    records: list[logging.LogRecord] = []
    handler = logging.Handler()
    handler.emit = records.append
    logger = llm_client.logger
    previous_level = logger.level
    previous_disabled = logger.disabled
    previous_global_disable = logging.root.manager.disable
    logger.addHandler(handler)
    logger.setLevel(logging.WARNING)
    logger.disabled = False
    logging.disable(logging.NOTSET)
    try:
        yield records
    finally:
        logger.setLevel(previous_level)
        logger.disabled = previous_disabled
        logging.disable(previous_global_disable)
        logger.removeHandler(handler)


class _FakeClient:
    """Minimal AssistantLlmClient stand-in: returns ``content`` or raises ``error``.

    Records every call so tests can assert kwarg pass-through and whether a
    downstream client was reached.
    """

    def __init__(
        self,
        *,
        base_url: str,
        content: str | None = None,
        error: Exception | None = None,
    ) -> None:
        self.base_url = base_url
        self.content = content
        self.error = error
        self.calls: list[dict[str, object]] = []

    async def complete(
        self,
        messages: list[dict[str, str]],
        *,
        role: str | None = None,
        temperature: float | None = None,
        max_tokens: int | None = None,
    ) -> str:
        self.calls.append({"role": role, "temperature": temperature, "max_tokens": max_tokens})
        if self.error is not None:
            raise self.error
        assert self.content is not None
        return self.content


def test_primary_success_skips_fallback() -> None:
    """When the primary answers, the fallback is never called."""
    primary = _FakeClient(base_url="primary", content="from-primary")
    fallback = _FakeClient(base_url="fallback", content="from-fallback")
    client = FailoverLlmClient([primary, fallback])

    result = asyncio.run(client.complete(_MESSAGES, role="x"))

    assert result == "from-primary"
    assert len(primary.calls) == 1
    assert fallback.calls == []


def test_failover_when_primary_unavailable() -> None:
    """A primary LlmUnavailable falls through to the next client."""
    primary = _FakeClient(base_url="primary", error=LlmUnavailable("primary down"))
    fallback = _FakeClient(base_url="fallback", content="from-fallback")
    client = FailoverLlmClient([primary, fallback])

    result = asyncio.run(client.complete(_MESSAGES, role="x"))

    assert result == "from-fallback"
    assert len(primary.calls) == 1
    assert len(fallback.calls) == 1


def test_all_clients_failing_raises_with_all_labels() -> None:
    """If every client fails, the error names each failed endpoint."""
    primary = _FakeClient(base_url="primary", error=LlmUnavailable("primary down"))
    fallback = _FakeClient(base_url="fallback", error=LlmUnavailable("fallback down"))
    client = FailoverLlmClient([primary, fallback])

    with pytest.raises(LlmUnavailable) as excinfo:
        asyncio.run(client.complete(_MESSAGES, role="x"))

    message = str(excinfo.value)
    assert "primary" in message
    assert "fallback" in message


def test_kwargs_are_forwarded() -> None:
    """role/temperature/max_tokens reach the underlying client unchanged."""
    primary = _FakeClient(base_url="primary", content="ok")
    client = FailoverLlmClient([primary])

    asyncio.run(client.complete(_MESSAGES, role="analyst", temperature=0.2, max_tokens=512))

    assert primary.calls[0] == {"role": "analyst", "temperature": 0.2, "max_tokens": 512}


def test_non_availability_error_propagates_without_failover() -> None:
    """A non-LlmUnavailable error is not masked and stops failover."""
    primary = _FakeClient(base_url="primary", error=RuntimeError("unexpected bug"))
    fallback = _FakeClient(base_url="fallback", content="from-fallback")
    client = FailoverLlmClient([primary, fallback])

    with pytest.raises(RuntimeError, match="unexpected bug"):
        asyncio.run(client.complete(_MESSAGES, role="x"))
    assert fallback.calls == []


def test_empty_client_list_raises_value_error() -> None:
    with pytest.raises(ValueError, match="at least one client"):
        FailoverLlmClient([])


def test_failover_emits_warning() -> None:
    """A non-final failure logs a warning naming the next endpoint."""
    primary = _FakeClient(base_url="primary", error=LlmUnavailable("down"))
    fallback = _FakeClient(base_url="fallback", content="ok")
    client = FailoverLlmClient([primary, fallback])

    with _capture_failover_logs() as records:
        asyncio.run(client.complete(_MESSAGES, role="x"))

    warnings = [r.getMessage() for r in records if "failing over" in r.getMessage()]
    assert len(warnings) == 1
    assert "fallback" in warnings[0]


def test_final_failure_emits_no_failover_warning() -> None:
    """The last client failing should not log a (non-existent) failover."""
    only = _FakeClient(base_url="only", error=LlmUnavailable("down"))
    client = FailoverLlmClient([only])

    with _capture_failover_logs() as records:
        with pytest.raises(LlmUnavailable):
            asyncio.run(client.complete(_MESSAGES, role="x"))

    assert not any("failing over" in r.getMessage() for r in records)

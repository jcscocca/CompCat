from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from app.assistant.localagent_client import LocalAgentUnavailable, OpenAiLlmClient

_DUMMY_REQUEST = httpx.Request("POST", "http://localhost:8080/v1/chat/completions")


def _make_client() -> OpenAiLlmClient:
    return OpenAiLlmClient(base_url="http://localhost:8080/v1", model="test-model")


def _json_response(data: object, status_code: int = 200) -> httpx.Response:
    content = json.dumps(data).encode()
    resp = httpx.Response(
        status_code=status_code,
        headers={"content-type": "application/json"},
        content=content,
        request=_DUMMY_REQUEST,
    )
    return resp


def test_complete_returns_content(monkeypatch: pytest.MonkeyPatch) -> None:
    """Normal response: choices[0].message.content is returned as-is."""
    response_data = {"choices": [{"message": {"content": "hi", "reasoning_content": ""}}]}

    async def fake_post(self_client, url, **kwargs):  # noqa: ANN001
        return _json_response(response_data)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    client = _make_client()
    result = asyncio.run(client.complete([{"role": "user", "content": "hello"}], role=None))
    assert result == "hi"


def test_empty_content_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Whitespace-only content triggers LocalAgentUnavailable."""
    response_data = {
        "choices": [{"message": {"content": "   ", "reasoning_content": "some thinking"}}]
    }

    async def fake_post(self_client, url, **kwargs):  # noqa: ANN001
        return _json_response(response_data)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    client = _make_client()
    with pytest.raises(LocalAgentUnavailable, match="empty content"):
        asyncio.run(client.complete([{"role": "user", "content": "hello"}], role=None))


def test_none_content_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """None content (key missing) triggers LocalAgentUnavailable."""
    response_data = {"choices": [{"message": {"reasoning_content": "some thinking"}}]}

    async def fake_post(self_client, url, **kwargs):  # noqa: ANN001
        return _json_response(response_data)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    client = _make_client()
    with pytest.raises(LocalAgentUnavailable, match="empty content"):
        asyncio.run(client.complete([{"role": "user", "content": "hello"}], role=None))


def test_http_error_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """An HTTP connection error is wrapped in LocalAgentUnavailable."""

    async def fake_post(self_client, url, **kwargs):  # noqa: ANN001
        raise httpx.ConnectError("connection refused")

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    client = _make_client()
    with pytest.raises(LocalAgentUnavailable, match="LLM endpoint unavailable"):
        asyncio.run(client.complete([{"role": "user", "content": "hello"}], role=None))


def test_bad_response_shape_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Unexpected JSON shape raises LocalAgentUnavailable."""
    response_data = {"result": "unexpected"}

    async def fake_post(self_client, url, **kwargs):  # noqa: ANN001
        return _json_response(response_data)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    client = _make_client()
    with pytest.raises(LocalAgentUnavailable, match="unexpected response shape"):
        asyncio.run(client.complete([{"role": "user", "content": "hello"}], role=None))


def test_http_status_error_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """A non-2xx HTTP status is wrapped in LocalAgentUnavailable."""

    async def fake_post(self_client, url, **kwargs):  # noqa: ANN001
        return _json_response({"error": "not found"}, status_code=404)

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    client = _make_client()
    with pytest.raises(LocalAgentUnavailable, match="LLM endpoint unavailable"):
        asyncio.run(client.complete([{"role": "user", "content": "hello"}], role=None))


def test_extra_body_is_merged_into_payload(monkeypatch: pytest.MonkeyPatch) -> None:
    """extra_body (e.g. chat_template_kwargs) is merged into the request payload."""
    captured: dict[str, object] = {}

    async def fake_post(self_client, url, **kwargs):  # noqa: ANN001
        captured.update(kwargs.get("json") or {})
        return _json_response({"choices": [{"message": {"content": "hi"}}]})

    monkeypatch.setattr(httpx.AsyncClient, "post", fake_post)

    client = OpenAiLlmClient(
        base_url="http://localhost:8080/v1",
        model="test-model",
        extra_body={"chat_template_kwargs": {"enable_thinking": False}},
    )
    result = asyncio.run(client.complete([{"role": "user", "content": "hello"}], role=None))

    assert result == "hi"
    assert captured["chat_template_kwargs"] == {"enable_thinking": False}
    assert captured["model"] == "test-model"  # base payload still intact

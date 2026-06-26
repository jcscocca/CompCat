from __future__ import annotations

from types import SimpleNamespace

from app.api.routes_assistant import build_assistant_llm_client
from app.assistant.localagent_client import FailoverLlmClient, OpenAiLlmClient

_NO_THINK = {"chat_template_kwargs": {"enable_thinking": False}}


def _settings(**overrides):
    base = {
        "llm_base_url": "http://primary:8080/v1",
        "llm_model": "gemma",
        "llm_disable_thinking": False,
        "llm_fallback_base_url": "",
        "llm_fallback_model": "",
        "llm_fallback_disable_thinking": False,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


def test_no_fallback_returns_bare_primary() -> None:
    client = build_assistant_llm_client(_settings())
    assert isinstance(client, OpenAiLlmClient)
    assert client.base_url == "http://primary:8080/v1"


def test_both_fallback_values_enable_failover() -> None:
    client = build_assistant_llm_client(
        _settings(llm_fallback_base_url="http://fb:8080/v1", llm_fallback_model="qwen")
    )
    assert isinstance(client, FailoverLlmClient)
    assert [c.base_url for c in client.clients] == [
        "http://primary:8080/v1",
        "http://fb:8080/v1",
    ]


def test_fallback_url_without_model_stays_primary() -> None:
    client = build_assistant_llm_client(_settings(llm_fallback_base_url="http://fb:8080/v1"))
    assert isinstance(client, OpenAiLlmClient)


def test_whitespace_only_fallback_values_stay_primary() -> None:
    client = build_assistant_llm_client(
        _settings(llm_fallback_base_url="   ", llm_fallback_model="   ")
    )
    assert isinstance(client, OpenAiLlmClient)


def test_disable_thinking_threads_into_both_extra_bodies() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_disable_thinking=True,
            llm_fallback_base_url="http://fb:8080/v1",
            llm_fallback_model="qwen",
            llm_fallback_disable_thinking=True,
        )
    )
    assert isinstance(client, FailoverLlmClient)
    primary, fallback = client.clients
    assert primary.extra_body == _NO_THINK
    assert fallback.extra_body == _NO_THINK


def test_thinking_enabled_leaves_extra_body_empty() -> None:
    client = build_assistant_llm_client(_settings())
    assert isinstance(client, OpenAiLlmClient)
    assert client.extra_body == {}

from __future__ import annotations

from types import SimpleNamespace

import pytest

from app.api.routes_assistant import build_assistant_llm_client
from app.assistant.llm_client import (
    AnthropicLlmClient,
    FailoverLlmClient,
    OpenAiLlmClient,
    OpenAiNativeLlmClient,
)

_NO_THINK = {"chat_template_kwargs": {"enable_thinking": False}}


def _settings(**overrides):
    base = {
        "llm_provider": "openai",
        "llm_fallback_provider": "openai",
        "llm_base_url": "http://primary:8080/v1",
        "llm_model": "gemma",
        "llm_disable_thinking": False,
        "llm_fallback_base_url": "",
        "llm_fallback_model": "",
        "llm_fallback_disable_thinking": False,
        "llm_api_key": "",
        "llm_fallback_api_key": "",
        "anthropic_api_key": "",
        "anthropic_model": "claude-sonnet-5",
        "anthropic_disable_thinking": True,
        "openai_api_key": "",
        "openai_model": "gpt-4o",
        "openai_base_url": "",
        "openai_send_temperature": True,
    }
    base.update(overrides)
    ns = SimpleNamespace(**base)
    ns.effective_llm_fallback_api_key = ns.llm_fallback_api_key or ns.llm_api_key
    return ns


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


def test_api_keys_reach_both_clients() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_api_key="gsk_primary",
            llm_fallback_base_url="http://fb:8080/v1",
            llm_fallback_model="qwen",
        )
    )
    assert [c.api_key for c in client.clients] == ["gsk_primary", "gsk_primary"]


def test_anthropic_provider_builds_anthropic_primary() -> None:
    client = build_assistant_llm_client(
        _settings(llm_provider="anthropic", anthropic_api_key="sk-ant-x")
    )
    assert isinstance(client, AnthropicLlmClient)
    assert client.model == "claude-sonnet-5"
    assert client.api_key == "sk-ant-x"


def test_anthropic_provider_without_key_raises() -> None:
    with pytest.raises(ValueError, match="anthropic"):
        build_assistant_llm_client(_settings(llm_provider="anthropic"))


def test_anthropic_fallback_after_openai_primary() -> None:
    client = build_assistant_llm_client(
        _settings(llm_fallback_provider="anthropic", anthropic_api_key="sk-ant-x")
    )
    assert isinstance(client, FailoverLlmClient)
    primary, fallback = client.clients
    assert isinstance(primary, OpenAiLlmClient)
    assert isinstance(fallback, AnthropicLlmClient)


def test_openai_fallback_after_anthropic_primary() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_provider="anthropic",
            anthropic_api_key="sk-ant-x",
            llm_fallback_base_url="http://fb:8080/v1",
            llm_fallback_model="qwen",
        )
    )
    assert isinstance(client, FailoverLlmClient)
    primary, fallback = client.clients
    assert isinstance(primary, AnthropicLlmClient)
    assert isinstance(fallback, OpenAiLlmClient)


def test_anthropic_fallback_disabled_without_key_stays_primary() -> None:
    client = build_assistant_llm_client(_settings(llm_fallback_provider="anthropic"))
    assert isinstance(client, OpenAiLlmClient)


def test_openai_native_provider_builds_native_primary() -> None:
    client = build_assistant_llm_client(
        _settings(llm_provider="openai_native", openai_api_key="sk-oai-x")
    )
    assert isinstance(client, OpenAiNativeLlmClient)
    assert client.model == "gpt-4o"
    assert client.api_key == "sk-oai-x"


def test_openai_native_provider_without_key_raises() -> None:
    with pytest.raises(ValueError, match="openai_native"):
        build_assistant_llm_client(_settings(llm_provider="openai_native"))


def test_openai_native_fallback_after_local_primary() -> None:
    client = build_assistant_llm_client(
        _settings(llm_fallback_provider="openai_native", openai_api_key="sk-oai-x")
    )
    assert isinstance(client, FailoverLlmClient)
    primary, fallback = client.clients
    assert isinstance(primary, OpenAiLlmClient)
    assert isinstance(fallback, OpenAiNativeLlmClient)


def test_openai_native_fallback_disabled_without_key_stays_primary() -> None:
    client = build_assistant_llm_client(_settings(llm_fallback_provider="openai_native"))
    assert isinstance(client, OpenAiLlmClient)


def test_openai_native_base_url_threads_through() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_provider="openai_native",
            openai_api_key="sk-oai-x",
            openai_base_url="https://proxy.example/v1",
        )
    )
    assert isinstance(client, OpenAiNativeLlmClient)
    assert client.base_url == "https://proxy.example/v1"


def test_invalid_provider_is_rejected() -> None:
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(llm_provider="claude")

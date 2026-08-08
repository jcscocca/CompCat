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
_GROQ_GPT_OSS = {"reasoning_effort": "low", "reasoning_format": "hidden"}
_GROQ_GPT_OSS_PLANNING = {"reasoning_effort": "medium"}


def _settings(**overrides):
    base = {
        "llm_provider": "openai",
        "llm_fallback_provider": "openai",
        "llm_third_provider": "",
        "llm_base_url": "http://primary:8080/v1",
        "llm_model": "gemma",
        "llm_timeout_s": 120.0,
        "llm_disable_thinking": False,
        "llm_fallback_base_url": "",
        "llm_fallback_model": "",
        "llm_fallback_disable_thinking": False,
        "llm_third_base_url": "",
        "llm_third_model": "",
        "llm_third_disable_thinking": False,
        "llm_api_key": "",
        "llm_fallback_api_key": "",
        "llm_third_api_key": "",
        "anthropic_api_key": "",
        "anthropic_model": "claude-sonnet-5",
        "anthropic_disable_thinking": True,
        "openai_api_key": "",
        "openai_model": "gpt-4o",
        "openai_base_url": "",
        "openai_send_temperature": True,
        "assistant_token_budget_per_day": 0,
    }
    base.update(overrides)
    ns = SimpleNamespace(**base)
    ns.effective_llm_fallback_api_key = ns.llm_fallback_api_key or ns.llm_api_key
    return ns


def test_no_fallback_returns_bare_primary() -> None:
    client = build_assistant_llm_client(_settings())
    assert isinstance(client, OpenAiLlmClient)
    assert client.base_url == "http://primary:8080/v1"
    assert client.timeout_s == 120.0


def test_timeout_threads_into_primary_and_fallback() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_timeout_s=240.0,
            llm_fallback_base_url="http://fb:8080/v1",
            llm_fallback_model="qwen",
        )
    )
    assert isinstance(client, FailoverLlmClient)
    assert [c.timeout_s for c in client.clients] == [240.0, 240.0]


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


def test_groq_gpt_oss_enables_reasoning_controls_and_structured_output() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_base_url="https://api.groq.com/openai/v1",
            llm_model="openai/gpt-oss-120b",
        )
    )

    assert isinstance(client, OpenAiLlmClient)
    assert client.extra_body == _GROQ_GPT_OSS
    assert client.supports_structured_output is True
    assert client.structured_extra_body == _GROQ_GPT_OSS_PLANNING


def test_local_gpt_oss_name_does_not_receive_groq_only_options() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_base_url="http://thinkpad:8080/v1",
            llm_model="openai/gpt-oss-120b",
        )
    )

    assert isinstance(client, OpenAiLlmClient)
    assert client.extra_body == {}
    assert client.supports_structured_output is False
    assert client.structured_extra_body == {}


def test_groq_gpt_oss_options_apply_to_fallback() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_fallback_base_url="https://api.groq.com/openai/v1",
            llm_fallback_model="openai/gpt-oss-120b",
        )
    )

    assert isinstance(client, FailoverLlmClient)
    fallback = client.clients[1]
    assert fallback.extra_body == _GROQ_GPT_OSS
    assert fallback.supports_structured_output is True
    assert fallback.structured_extra_body == _GROQ_GPT_OSS_PLANNING


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


def test_third_slot_is_off_by_default() -> None:
    client = build_assistant_llm_client(
        _settings(llm_fallback_base_url="http://fb:8080/v1", llm_fallback_model="qwen")
    )
    assert isinstance(client, FailoverLlmClient)
    assert len(client.clients) == 2


def test_three_backends_chain_in_configured_order() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_provider="anthropic",
            anthropic_api_key="sk-ant-x",
            llm_fallback_base_url="https://api.groq.com/openai/v1",
            llm_fallback_model="openai/gpt-oss-120b",
            llm_fallback_api_key="gsk_groq",
            llm_third_provider="openai_native",
            openai_api_key="sk-oai-x",
        )
    )
    assert isinstance(client, FailoverLlmClient)
    primary, fallback, third = client.clients
    assert isinstance(primary, AnthropicLlmClient)
    assert isinstance(fallback, OpenAiLlmClient)
    assert isinstance(third, OpenAiNativeLlmClient)


def test_third_slot_activates_without_a_fallback() -> None:
    # Slots are independent: an unconfigured fallback does not block the third.
    client = build_assistant_llm_client(
        _settings(llm_third_provider="anthropic", anthropic_api_key="sk-ant-x")
    )
    assert isinstance(client, FailoverLlmClient)
    primary, third = client.clients
    assert isinstance(primary, OpenAiLlmClient)
    assert isinstance(third, AnthropicLlmClient)


def test_third_openai_slot_needs_both_base_url_and_model() -> None:
    client = build_assistant_llm_client(
        _settings(llm_third_provider="openai", llm_third_base_url="http://third:8080/v1")
    )
    assert isinstance(client, OpenAiLlmClient)


def test_third_slot_key_is_not_inherited_from_primary() -> None:
    # Unlike the fallback slot, the third never borrows MCA_LLM_API_KEY — a three-backend
    # chain spans three vendors, so inheriting would cross-post one vendor's credential.
    client = build_assistant_llm_client(
        _settings(
            llm_api_key="gsk_primary",
            llm_third_provider="openai",
            llm_third_base_url="http://third:8080/v1",
            llm_third_model="qwen",
        )
    )
    assert isinstance(client, FailoverLlmClient)
    assert [c.api_key for c in client.clients] == ["gsk_primary", ""]


def test_third_slot_uses_its_own_key() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_api_key="gsk_primary",
            llm_third_provider="openai",
            llm_third_base_url="http://third:8080/v1",
            llm_third_model="qwen",
            llm_third_api_key="sk-third",
        )
    )
    assert [c.api_key for c in client.clients] == ["gsk_primary", "sk-third"]


def test_duplicate_key_based_backend_is_dropped() -> None:
    # anthropic in two slots resolves to one endpoint (one shared key family), so the
    # chain must not queue it behind itself.
    client = build_assistant_llm_client(
        _settings(
            llm_provider="anthropic",
            anthropic_api_key="sk-ant-x",
            llm_third_provider="anthropic",
        )
    )
    assert isinstance(client, AnthropicLlmClient)


def test_duplicate_openai_endpoint_is_dropped() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_fallback_base_url="http://fb:8080/v1",
            llm_fallback_model="qwen",
            llm_third_provider="openai",
            llm_third_base_url="http://fb:8080/v1",
            llm_third_model="qwen",
        )
    )
    assert isinstance(client, FailoverLlmClient)
    assert len(client.clients) == 2


def test_same_host_different_model_is_not_a_duplicate() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_fallback_base_url="http://fb:8080/v1",
            llm_fallback_model="qwen",
            llm_third_provider="openai",
            llm_third_base_url="http://fb:8080/v1",
            llm_third_model="gemma",
        )
    )
    assert [c.model for c in client.clients] == ["gemma", "qwen", "gemma"]


def test_third_anthropic_without_key_is_skipped() -> None:
    client = build_assistant_llm_client(_settings(llm_third_provider="anthropic"))
    assert isinstance(client, OpenAiLlmClient)


def test_third_slot_timeout_and_thinking_thread_through() -> None:
    client = build_assistant_llm_client(
        _settings(
            llm_timeout_s=240.0,
            llm_third_provider="openai",
            llm_third_base_url="http://third:8080/v1",
            llm_third_model="qwen",
            llm_third_disable_thinking=True,
        )
    )
    third = client.clients[1]
    assert third.timeout_s == 240.0
    assert third.extra_body == _NO_THINK


def test_invalid_third_provider_is_rejected() -> None:
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(_env_file=None, llm_third_provider="claude")


def test_invalid_provider_is_rejected() -> None:
    from pydantic import ValidationError

    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(llm_provider="claude")


def test_openai_compatible_timeout_default_and_validation() -> None:
    from pydantic import ValidationError

    from app.config import Settings

    assert Settings(_env_file=None).llm_timeout_s == 120.0
    with pytest.raises(ValidationError):
        Settings(_env_file=None, llm_timeout_s=0)

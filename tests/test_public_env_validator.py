from __future__ import annotations

from pathlib import Path

import pytest

from scripts.public.validate_public_env import (
    effective_env_values,
    main,
    public_posture_errors,
    read_env_file,
)


def _safe_values(**overrides: str) -> dict[str, str]:
    session_secret = _fixture_secret("session")
    hash_salt = _fixture_secret("hash-salt")
    admin_token = _fixture_secret("admin")
    database_password = _fixture_secret("database")
    values = {
        "MCA_ENVIRONMENT": "production",
        "MCA_SESSION_COOKIE_SECURE": "true",
        "MCA_RATE_LIMIT_ENABLED": "true",
        "MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS": "false",
        "MCA_INTERNAL_TIER_ENABLED": "false",
        "MCA_TRUST_PROXY_HEADERS": "true",
        "MCA_TRUST_X_FORWARDED_FOR": "false",
        "MCA_SESSION_SECRET": session_secret,
        "MCA_USER_HASH_SALT": hash_salt,
        "MCA_ADMIN_INGEST_TOKEN": admin_token,
        "MCA_DATABASE_URL": f"postgresql+psycopg://mca:{database_password}@db:5432/mca",
        "MCA_GEOCODER_CONTACT_EMAIL": "ops@example.com",
        "POSTGRES_PASSWORD": database_password,
        "CLOUDFLARE_TUNNEL_TOKEN": _fixture_secret("cloudflare"),
    }
    values.update(overrides)
    return values


def _fixture_secret(label: str) -> str:
    """Long/diverse but visibly synthetic value that secret scanners need not suppress."""

    return f"example-{label}-credential-not-real-1234567890"


def test_safe_tunnel_posture_passes() -> None:
    assert public_posture_errors(_safe_values(), mode="tunnel") == []


def test_safe_vps_posture_passes_without_tunnel_token() -> None:
    values = _safe_values(MCA_TRUST_X_FORWARDED_FOR="true")
    values.pop("CLOUDFLARE_TUNNEL_TOKEN")
    assert public_posture_errors(values, mode="vps") == []


def test_each_unsafe_public_toggle_fails_closed() -> None:
    for name, unsafe in (
        ("MCA_ENVIRONMENT", "local"),
        ("MCA_SESSION_COOKIE_SECURE", "false"),
        ("MCA_RATE_LIMIT_ENABLED", "false"),
        ("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", "true"),
        ("MCA_INTERNAL_TIER_ENABLED", "true"),
        ("MCA_TRUST_PROXY_HEADERS", "false"),
        ("MCA_TRUST_X_FORWARDED_FOR", "true"),
    ):
        errors = public_posture_errors(_safe_values(**{name: unsafe}), mode="tunnel")
        assert any(name in error for error in errors)


def test_missing_and_placeholder_secrets_fail_without_echoing_values() -> None:
    values = _safe_values(MCA_SESSION_SECRET="", MCA_ADMIN_INGEST_TOKEN="__replace me__")
    errors = public_posture_errors(values, mode="tunnel")
    assert any("MCA_SESSION_SECRET" in error and "must be set" in error for error in errors)
    assert any("MCA_ADMIN_INGEST_TOKEN" in error and "placeholder" in error for error in errors)
    assert all("replace me" not in error for error in errors)


def test_double_underscore_in_a_real_secret_is_not_mistaken_for_a_placeholder() -> None:
    assert (
        public_posture_errors(
            _safe_values(MCA_SESSION_SECRET=_fixture_secret("generated__secret")), mode="tunnel"
        )
        == []
    )


@pytest.mark.parametrize(
    ("name", "weak_value"),
    (
        ("MCA_SESSION_SECRET", "session-secret"),
        ("MCA_USER_HASH_SALT", "hash-salt"),
        ("MCA_ADMIN_INGEST_TOKEN", "admin-token"),
        ("POSTGRES_PASSWORD", "database-password"),
        ("CLOUDFLARE_TUNNEL_TOKEN", "tunnel-token"),
        ("MCA_SESSION_SECRET", "a" * 64),
    ),
)
def test_trivial_required_secrets_fail_without_echoing_values(name: str, weak_value: str) -> None:
    overrides = {name: weak_value}
    if name == "POSTGRES_PASSWORD":
        overrides["MCA_DATABASE_URL"] = f"postgresql+psycopg://mca:{weak_value}@db:5432/mca"

    errors = public_posture_errors(_safe_values(**overrides), mode="tunnel")

    assert any(name in error and "non-trivial secret" in error for error in errors)
    assert all(weak_value not in error for error in errors)


@pytest.mark.parametrize(
    "indirect_value",
    (
        "${MISSING_VAR}",
        "${MISSING_VAR:-fallback}",
        "$MISSING_VAR",
        "$${MISSING_VAR}",
        "prefix-${MISSING_VAR}-suffix",
    ),
)
@pytest.mark.parametrize(
    "name",
    (
        "MCA_SESSION_SECRET",
        "MCA_USER_HASH_SALT",
        "MCA_ADMIN_INGEST_TOKEN",
        "MCA_DATABASE_URL",
        "MCA_GEOCODER_CONTACT_EMAIL",
        "POSTGRES_PASSWORD",
        "CLOUDFLARE_TUNNEL_TOKEN",
    ),
)
def test_compose_interpolation_is_rejected_without_echoing_value(
    name: str, indirect_value: str
) -> None:
    values = _safe_values(**{name: indirect_value})
    if name == "POSTGRES_PASSWORD":
        values["MCA_DATABASE_URL"] = f"postgresql+psycopg://mca:{indirect_value}@db:5432/mca"

    errors = public_posture_errors(values, mode="tunnel")

    assert any(name in error and "Compose interpolation" in error for error in errors)
    assert all(indirect_value not in error for error in errors)


def test_documented_local_tunnel_sentinel_remains_valid() -> None:
    assert (
        public_posture_errors(
            _safe_values(CLOUDFLARE_TUNNEL_TOKEN="unused-locally-managed"), mode="tunnel"
        )
        == []
    )


@pytest.mark.parametrize(
    "invalid_email",
    ("ops", "ops@localhost", "@example.com", "ops example@example.com"),
)
def test_geocoder_contact_must_be_an_email_without_echoing_value(
    invalid_email: str,
) -> None:
    errors = public_posture_errors(
        _safe_values(MCA_GEOCODER_CONTACT_EMAIL=invalid_email), mode="tunnel"
    )
    assert any(
        "MCA_GEOCODER_CONTACT_EMAIL" in error and "valid contact email" in error for error in errors
    )
    assert all(invalid_email not in error for error in errors)


def test_database_must_target_the_project_compose_service() -> None:
    password = _safe_values()["POSTGRES_PASSWORD"]
    for url in (
        f"postgresql+psycopg://mca:{password}@personal-db:5432/mca",
        f"postgresql+psycopg://other:{password}@db:5432/mca",
        f"postgresql+psycopg://mca:{password}@db:5433/mca",
        f"postgresql+psycopg://mca:{password}@db:5432/personal",
        f"postgresql+psycopg://mca:{password}@example.com:5432/mca",
    ):
        errors = public_posture_errors(_safe_values(MCA_DATABASE_URL=url), mode="tunnel")
        assert any("MCA_DATABASE_URL" in error and "Compose database" in error for error in errors)


def test_database_password_must_match_without_echoing_either_value() -> None:
    different_secret = _fixture_secret("different-database")
    errors = public_posture_errors(_safe_values(POSTGRES_PASSWORD=different_secret), mode="tunnel")
    assert errors == ["MCA_DATABASE_URL password must match POSTGRES_PASSWORD"]
    database_password = _safe_values()["POSTGRES_PASSWORD"]
    assert all(database_password not in error and different_secret not in error for error in errors)


def test_env_reader_preserves_equals_hashes_and_strips_outer_quotes(tmp_path: Path) -> None:
    path = tmp_path / ".env"
    path.write_text(
        "# comment\nMCA_DATABASE_URL='postgresql://mca:p=a#ss@db/mca'\nFLAG=true\n",
        encoding="utf-8",
    )
    assert read_env_file(path) == {
        "MCA_DATABASE_URL": "postgresql://mca:p=a#ss@db/mca",
        "FLAG": "true",
    }


def test_cli_returns_nonzero_and_names_only_bad_fields(tmp_path: Path, capsys) -> None:
    path = tmp_path / ".env.tunnel"
    path.write_text("MCA_ENVIRONMENT=local\n", encoding="utf-8")
    assert main(["--mode", "tunnel", str(path)]) == 1
    captured = capsys.readouterr()
    assert "MCA_ENVIRONMENT" in captured.err
    assert "Public posture check failed" in captured.err


def test_effective_values_and_cli_reject_hostile_exported_overrides(
    tmp_path: Path, capsys, monkeypatch
) -> None:
    values = _safe_values()
    path = tmp_path / ".env.tunnel"
    path.write_text(
        "\n".join(f"{name}={value}" for name, value in values.items()),
        encoding="utf-8",
    )
    monkeypatch.setenv("MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS", "true")
    monkeypatch.setenv("MCA_INTERNAL_TIER_ENABLED", "true")

    effective = effective_env_values(read_env_file(path))
    assert effective["MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS"] == "true"
    assert effective["MCA_INTERNAL_TIER_ENABLED"] == "true"
    assert main(["--mode", "tunnel", str(path)]) == 1

    error = capsys.readouterr().err
    assert "MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS" in error
    assert "MCA_INTERNAL_TIER_ENABLED" in error


def test_cli_rejects_interpolation_from_process_environment_without_echoing_it(
    tmp_path: Path, capsys, monkeypatch
) -> None:
    values = _safe_values()
    path = tmp_path / ".env.tunnel"
    path.write_text(
        "\n".join(f"{name}={value}" for name, value in values.items()),
        encoding="utf-8",
    )
    indirect_value = "${MISSING_SESSION_SECRET}"
    monkeypatch.setenv("MCA_SESSION_SECRET", indirect_value)

    assert main(["--mode", "tunnel", str(path)]) == 1

    error = capsys.readouterr().err
    assert "MCA_SESSION_SECRET" in error
    assert "Compose interpolation" in error
    assert indirect_value not in error

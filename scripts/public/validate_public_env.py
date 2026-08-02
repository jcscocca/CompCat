from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit

COMMON_EXACT_VALUES = {
    "MCA_ENVIRONMENT": "production",
    "MCA_SESSION_COOKIE_SECURE": "true",
    "MCA_RATE_LIMIT_ENABLED": "true",
    "MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS": "false",
    "MCA_INTERNAL_TIER_ENABLED": "false",
    "MCA_TRUST_PROXY_HEADERS": "true",
}

COMMON_REQUIRED_VALUES = (
    "MCA_SESSION_SECRET",
    "MCA_USER_HASH_SALT",
    "MCA_ADMIN_INGEST_TOKEN",
    "MCA_DATABASE_URL",
    "MCA_GEOCODER_CONTACT_EMAIL",
    "POSTGRES_PASSWORD",
)

MODE_EXACT_VALUES = {
    "tunnel": {"MCA_TRUST_X_FORWARDED_FOR": "false"},
    "vps": {"MCA_TRUST_X_FORWARDED_FOR": "true"},
}

MODE_REQUIRED_VALUES = {
    "tunnel": ("CLOUDFLARE_TUNNEL_TOKEN",),
    "vps": (),
}

_VALIDATED_NAMES = frozenset(
    (
        *COMMON_EXACT_VALUES,
        *COMMON_REQUIRED_VALUES,
        *(name for values in MODE_EXACT_VALUES.values() for name in values),
        *(name for values in MODE_REQUIRED_VALUES.values() for name in values),
    )
)

_EXAMPLE_PLACEHOLDER_RE = re.compile(
    r"__(?:run:|same password as above|your\s|paste\s|replace\b).*?__",
    re.IGNORECASE,
)

# Compose expands both ``$NAME`` and ``${NAME...}`` in env-file values. Public secrets must be
# concrete at preflight time: accepting indirection makes the validator approve one value while
# Compose can launch with another (or with an empty expansion). The pattern also catches escaped
# forms such as ``$${NAME}`` by matching the second dollar sign.
_COMPOSE_INTERPOLATION_RE = re.compile(r"\$(?:\{[^}\r\n]*(?:\}|$)|[A-Za-z_][A-Za-z0-9_]*)")

# These minima sit below the documented openssl outputs (64 characters for the session secret and
# hash salt; 48 for the admin token and database password) while still rejecting copy/paste values
# such as "secret", "admin-token", and "password". A small diversity floor catches padded forms
# such as 64 repeated characters without imposing character-class rules that would reject hex.
_SECRET_MIN_LENGTHS = {
    "MCA_SESSION_SECRET": 32,
    "MCA_USER_HASH_SALT": 32,
    "MCA_ADMIN_INGEST_TOKEN": 32,
    "POSTGRES_PASSWORD": 32,
    "CLOUDFLARE_TUNNEL_TOKEN": 32,
}
_MIN_SECRET_UNIQUE_CHARACTERS = 8

# The documented locally-managed tunnel fallback replaces the token-consuming Compose command
# with a mounted credentials file. Compose still insists that the original interpolation exists,
# so the runbook uses this explicit non-secret sentinel. It is not accepted for any other field.
_DOCUMENTED_NON_SECRET_SENTINELS = {
    "CLOUDFLARE_TUNNEL_TOKEN": frozenset({"unused-locally-managed"}),
}

_CONTACT_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _required_value_error(name: str, value: str) -> str | None:
    """Return a field-only error for an unsafe required value.

    Never include ``value`` in the returned text: this function validates credentials and its
    messages are printed to deployment terminals and CI logs.
    """

    if _EXAMPLE_PLACEHOLDER_RE.search(value):
        return f"{name} still contains an example placeholder"
    if _COMPOSE_INTERPOLATION_RE.search(value):
        return f"{name} must be a concrete value, not Compose interpolation"

    minimum = _SECRET_MIN_LENGTHS.get(name)
    allowed_sentinels = _DOCUMENTED_NON_SECRET_SENTINELS.get(name, ())
    if minimum is not None and value not in allowed_sentinels:
        if len(value) < minimum or len(set(value)) < _MIN_SECRET_UNIQUE_CHARACTERS:
            return f"{name} must be a non-trivial secret of at least {minimum} characters"

    if name == "MCA_GEOCODER_CONTACT_EMAIL" and not _CONTACT_EMAIL_RE.fullmatch(value):
        return f"{name} must be a valid contact email address"
    return None


def _database_posture_errors(values: dict[str, str]) -> list[str]:
    """Require the isolated Compose database and one consistent credential.

    Both public launchers put the API beside the project-owned ``db`` service. Accepting an
    arbitrary host would make a typo—or a copied personal-instance URL—pass the fail-closed
    preflight. Error text names fields only and never interpolates credentials.
    """

    raw_url = values.get("MCA_DATABASE_URL", "").strip()
    password = values.get("POSTGRES_PASSWORD", "").strip()
    if not raw_url or not password:
        return []  # Required-value errors already identify the missing field.
    try:
        parsed = urlsplit(raw_url)
        valid_target = (
            parsed.scheme == "postgresql+psycopg"
            and parsed.hostname == "db"
            and parsed.port == 5432
            and parsed.username == "mca"
            and parsed.path == "/mca"
            and not parsed.query
            and not parsed.fragment
        )
    except ValueError:
        valid_target = False
        parsed = None
    if not valid_target or parsed is None:
        return ["MCA_DATABASE_URL must target the public Compose database"]
    if unquote(parsed.password or "") != password:
        return ["MCA_DATABASE_URL password must match POSTGRES_PASSWORD"]
    return []


def read_env_file(path: Path) -> dict[str, str]:
    """Read the simple KEY=VALUE form used by CompCat's deployment env files.

    Values may contain additional ``=`` characters (notably MCA_DATABASE_URL), so only the
    first separator is structural. Quotes surrounding an entire value are removed; inline
    comments are deliberately not interpreted because credentials may contain ``#``.
    """

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, raw_value = line.partition("=")
        key = key.strip()
        value = raw_value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[key] = value
    return values


def effective_env_values(file_values: dict[str, str]) -> dict[str, str]:
    """Apply Docker Compose's process-environment precedence for validated fields."""

    values = dict(file_values)
    for name in _VALIDATED_NAMES:
        if name in os.environ:
            values[name] = os.environ[name]
    return values


def public_posture_errors(values: dict[str, str], *, mode: str) -> list[str]:
    expected_values = {**COMMON_EXACT_VALUES, **MODE_EXACT_VALUES[mode]}
    errors = [
        f"{name} must be {expected!r} for the public {mode} posture"
        for name, expected in expected_values.items()
        if values.get(name, "").strip().lower() != expected
    ]

    for name in (*COMMON_REQUIRED_VALUES, *MODE_REQUIRED_VALUES[mode]):
        value = values.get(name, "").strip()
        if not value:
            errors.append(f"{name} must be set for the public {mode} posture")
        elif error := _required_value_error(name, value):
            errors.append(error)
    errors.extend(_database_posture_errors(values))
    return errors


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Fail closed when a public CompCat deployment env is unsafe."
    )
    parser.add_argument("env_file", type=Path)
    parser.add_argument("--mode", choices=tuple(MODE_EXACT_VALUES), required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if not args.env_file.is_file():
        print(f"Public posture check failed: missing {args.env_file}", file=sys.stderr)
        return 1

    # Docker Compose gives exported process values precedence over --env-file. Validate that
    # effective posture, not merely the reassuring text on disk, so a stale shell variable
    # cannot re-enable uploads/internal routes after this check passes.
    values = effective_env_values(read_env_file(args.env_file))
    errors = public_posture_errors(values, mode=args.mode)
    if errors:
        print("Public posture check failed:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        return 1

    print(f"Public posture: validated {args.mode} settings in {args.env_file}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

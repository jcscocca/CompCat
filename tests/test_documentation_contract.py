from __future__ import annotations

import re
from pathlib import Path

from fastapi.routing import APIRoute

from app.main import app
from app.models import Base

ROOT = Path(__file__).resolve().parents[1]
CANONICAL_API_DOC = ROOT / "docs" / "architecture" / "api.md"
README = ROOT / "README.md"
_FRONTEND_SHELL_PATHS = {"/", "/dashboard-app/{path:path}"}

_MARKDOWN_LINK = re.compile(r"\[[^\]\n]*\]\(([^)\n]+)\)")
_API_TABLE_ROUTE = re.compile(
    r"^\|\s*`(?P<path>/[^`]+)`\s*\|\s*(?P<method>GET|POST|PATCH|PUT|DELETE)\s*\|",
    re.MULTILINE,
)
_INLINE_ROUTE = re.compile(
    r"`(?P<method>GET|POST|PATCH|PUT|DELETE)\s+(?P<path>/[^`\s]+)`"
)


def _normalize_path(path: str) -> str:
    """Compare route shapes without coupling docs to handler parameter names."""

    return re.sub(r"\{[^}]+\}", "{}", path)


def _registered_api_routes() -> set[tuple[str, str]]:
    routes: set[tuple[str, str]] = set()
    # FastAPI 0.141 keeps included routers as lazy `_IncludedRouter` objects instead of
    # flattening their APIRoutes into `app.routes`. Older supported FastAPI releases expose
    # the APIRoutes directly, so accept both shapes.
    candidates = []
    for app_route in app.routes:
        original_router = getattr(app_route, "original_router", None)
        candidates.extend(original_router.routes if original_router is not None else [app_route])
    for route in candidates:
        if not isinstance(route, APIRoute):
            continue
        if route.path in _FRONTEND_SHELL_PATHS:
            continue
        for method in route.methods or set():
            if method not in {"HEAD", "OPTIONS"}:
                routes.add((method, _normalize_path(route.path)))
    return routes


def _documented_api_table_routes(text: str) -> set[tuple[str, str]]:
    return {
        (match.group("method"), _normalize_path(match.group("path")))
        for match in _API_TABLE_ROUTE.finditer(text)
    }


def _documented_inline_routes(text: str) -> set[tuple[str, str]]:
    return {
        (match.group("method"), _normalize_path(match.group("path")))
        for match in _INLINE_ROUTE.finditer(text)
    }


def test_canonical_api_route_table_matches_the_application() -> None:
    registered = _registered_api_routes()
    documented = _documented_api_table_routes(CANONICAL_API_DOC.read_text())

    assert documented == registered, (
        f"missing from docs: {sorted(registered - documented)}; "
        f"stale in docs: {sorted(documented - registered)}"
    )


def test_readme_route_inventory_covers_the_application() -> None:
    registered = _registered_api_routes()
    documented = _documented_inline_routes(README.read_text())

    assert registered <= documented, f"missing from README: {sorted(registered - documented)}"


def test_documented_model_count_matches_sqlalchemy_metadata() -> None:
    count = len(Base.metadata.tables)
    docs_index = (ROOT / "docs" / "README.md").read_text()
    data_model = (ROOT / "docs" / "architecture" / "data-model.md").read_text()

    assert f"The {count} SQLAlchemy entities" in docs_index
    assert f"Total: **{count} tables**" in data_model


def test_maintained_markdown_links_resolve() -> None:
    markdown_files = [*ROOT.glob("*.md"), *ROOT.glob("docs/**/*.md")]
    maintained = [path for path in markdown_files if "superpowers" not in path.parts]
    broken: list[str] = []

    for source in maintained:
        for raw_target in _MARKDOWN_LINK.findall(source.read_text()):
            target = raw_target.strip().removeprefix("<").removesuffix(">")
            target = target.split("#", 1)[0]
            if not target or target.startswith(("http://", "https://", "mailto:")):
                continue
            resolved = (source.parent / target).resolve()
            if not resolved.exists():
                broken.append(f"{source.relative_to(ROOT)} -> {raw_target}")

    assert not broken, "broken local documentation links:\n" + "\n".join(sorted(broken))

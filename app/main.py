from __future__ import annotations

import json
import logging
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from app.api.routes_admin_crime import router as admin_crime_router
from app.api.routes_admin_maintenance import router as admin_maintenance_router
from app.api.routes_analysis import router as analysis_router
from app.api.routes_assistant import router as assistant_router
from app.api.routes_crime import router as crime_router
from app.api.routes_dashboard import router as dashboard_router
from app.api.routes_exports import router as exports_router
from app.api.routes_health import router as health_router
from app.api.routes_imports import router as imports_router
from app.api.routes_input_modes import router as input_modes_router
from app.api.routes_places import router as places_router
from app.api.routes_public_dashboard import router as public_dashboard_router
from app.api.routes_public_places import router as public_places_router
from app.api.routes_sessions import router as sessions_router
from app.api.routes_uploads import router as uploads_router
from app.config import Settings, get_settings
from app.db import configure_database, init_db
from app.ratelimit import BurstLimitMiddleware
from app.request_limits import RequestBodyLimitMiddleware
from app.response_security import ResponseSecurityMiddleware

logger = logging.getLogger(__name__)


class OptionalStaticFiles(StaticFiles):
    """Static files whose source directory may be provisioned after app startup.

    Starlette's ``check_dir=False`` defers its directory check until the first request;
    it does not disable that check.  The PMTiles artifact is intentionally optional, so
    an absent directory must behave like an absent file rather than raising at runtime.
    Existing non-directory paths and other configuration errors remain loud.
    """

    async def check_config(self) -> None:
        try:
            await super().check_config()
        except RuntimeError:
            if self.directory is not None and not Path(self.directory).exists():
                return
            raise


def log_posture_warnings(settings: Settings) -> None:
    """Loud boot-time warnings for prod-like postures that are one env var away from real
    exposure. Warn, never block — both toggles have legitimate single-host uses."""
    if not settings.is_production_like:
        return
    if settings.internal_tier_enabled:
        logger.warning(
            "MCA_INTERNAL_TIER_ENABLED=true in a production-like environment: the "
            "internal tier is unauthenticated — keep it behind a trusted boundary."
        )
    if settings.public_enable_personal_uploads:
        logger.warning(
            "MCA_PUBLIC_ENABLE_PERSONAL_UPLOADS=true in a production-like environment: "
            "personal uploads store real location data — keep OFF on shared instances."
        )


def _install_validation_error_handler(app: FastAPI) -> None:
    """Render 422s with ensure_ascii=True.

    FastAPI's default handler echoes the offending input back. JSON accepts lone
    surrogates (\\ud800), so an invalid field carrying one is parsed fine, rejected by
    pydantic, then echoed — and Starlette's JSONResponse renders with ensure_ascii=False,
    which raises UnicodeEncodeError inside the handler. The client got a 500 for what is a
    plain bad request. Escaping non-ASCII makes any input round-trip safely; the error
    detail (loc/msg/type) is otherwise unchanged.
    """

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_request: Request, exc: RequestValidationError):
        body = json.dumps(
            {"detail": jsonable_encoder(exc.errors())}, ensure_ascii=True, default=str
        )
        return Response(
            content=body, status_code=422, media_type="application/json"
        )


def mount_dashboard(app: FastAPI) -> None:
    static_dir = Path(get_settings().static_dashboard_dir)
    index_file = static_dir / "index.html"
    if not index_file.exists():
        return

    assets_dir = static_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="dashboard-assets")

    # Map glyphs/sprites: vite copies frontend/public/basemaps-assets/ into the build,
    # but only /assets is mounted above — the map style requests these at /basemaps-assets/.
    basemap_assets_dir = static_dir / "basemaps-assets"
    if basemap_assets_dir.exists():
        app.mount(
            "/basemaps-assets",
            StaticFiles(directory=basemap_assets_dir),
            name="basemap-assets",
        )

    # Self-hosted UI fonts (frontend/public/fonts/): fonts.css requests them at /fonts/.
    fonts_dir = static_dir / "fonts"
    if fonts_dir.exists():
        app.mount("/fonts", StaticFiles(directory=fonts_dir), name="dashboard-fonts")

    @app.get("/", include_in_schema=False)
    def dashboard_index() -> FileResponse:
        return FileResponse(index_file)

    @app.get("/dashboard-app/{path:path}", include_in_schema=False)
    def dashboard_fallback(path: str) -> FileResponse:
        return FileResponse(index_file)


def create_app(database_url: str | None = None) -> FastAPI:
    settings = get_settings()
    log_posture_warnings(settings)
    configure_database(database_url)
    init_db()
    # The interactive docs are a local/dev affordance. On a public deployment they hand
    # out a complete machine-readable map of the surface, and Swagger UI is a live request
    # console against it — so the schema and both UIs are off in a prod-like environment.
    docs_enabled = not settings.is_production_like
    app = FastAPI(
        title="CompCat",
        version="0.1.0",
        description="Privacy-first recurring-place and Seattle crime context API.",
        docs_url="/docs" if docs_enabled else None,
        redoc_url="/redoc" if docs_enabled else None,
        openapi_url="/openapi.json" if docs_enabled else None,
    )
    _install_validation_error_handler(app)
    app.include_router(health_router)
    app.include_router(sessions_router)
    app.include_router(imports_router)
    app.include_router(input_modes_router)
    app.include_router(places_router)
    app.include_router(public_places_router)
    app.include_router(uploads_router)
    app.include_router(crime_router)
    app.include_router(admin_crime_router)
    app.include_router(admin_maintenance_router)
    app.include_router(dashboard_router)
    app.include_router(public_dashboard_router)
    app.include_router(assistant_router)
    app.include_router(exports_router)
    app.include_router(analysis_router)
    # Self-hosted basemap tiles (see docs/superpowers/specs/2026-07-04-map-ui-overhaul-design.md).
    # The artifact is fetched out-of-band (make fetch-tiles). OptionalStaticFiles makes a
    # missing directory or file a plain 404 so the frontend can fall back to a flat basemap.
    app.mount(
        "/tiles",
        OptionalStaticFiles(directory=get_settings().tiles_dir, check_dir=False),
        name="tiles",
    )
    mount_dashboard(app)
    # FastAPI wraps middleware in reverse registration order. Response security is outermost
    # so even rate-limit and internal-gate responses get browser hardening; accepted requests
    # then hit the body cap before FastAPI routing or multipart parsing.
    app.add_middleware(RequestBodyLimitMiddleware, get_settings_fn=get_settings)
    app.add_middleware(BurstLimitMiddleware, get_settings_fn=get_settings)
    app.add_middleware(ResponseSecurityMiddleware)
    return app


app = create_app()

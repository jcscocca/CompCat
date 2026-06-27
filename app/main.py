from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes_admin_crime import router as admin_crime_router
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
from app.api.routes_public_routes import router as public_routes_router
from app.api.routes_routes import router as routes_router
from app.api.routes_sessions import router as sessions_router
from app.api.routes_uploads import router as uploads_router
from app.config import get_settings
from app.db import configure_database, init_db


def mount_dashboard(app: FastAPI) -> None:
    static_dir = Path(get_settings().static_dashboard_dir)
    index_file = static_dir / "index.html"
    if not index_file.exists():
        return

    assets_dir = static_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="dashboard-assets")

    @app.get("/", include_in_schema=False)
    def dashboard_index() -> FileResponse:
        return FileResponse(index_file)

    @app.get("/dashboard-app/{path:path}", include_in_schema=False)
    def dashboard_fallback(path: str) -> FileResponse:
        return FileResponse(index_file)


def create_app(database_url: str | None = None) -> FastAPI:
    configure_database(database_url)
    init_db()
    app = FastAPI(
        title="Waypoint",
        version="0.1.0",
        description="Privacy-first recurring-place and Seattle crime context API.",
    )
    app.include_router(health_router)
    app.include_router(sessions_router)
    app.include_router(imports_router)
    app.include_router(input_modes_router)
    app.include_router(places_router)
    app.include_router(public_places_router)
    app.include_router(public_routes_router)
    app.include_router(uploads_router)
    app.include_router(crime_router)
    app.include_router(admin_crime_router)
    app.include_router(routes_router)
    app.include_router(dashboard_router)
    app.include_router(public_dashboard_router)
    app.include_router(assistant_router)
    app.include_router(exports_router)
    app.include_router(analysis_router)
    mount_dashboard(app)
    return app


app = create_app()

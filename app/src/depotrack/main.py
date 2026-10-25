"""FastAPI application entry point."""

import logging

from fastapi import FastAPI

from depotrack import __version__
from depotrack.api import system
from depotrack.core.config import get_settings
from depotrack.core.spa import mount_spa


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    app = FastAPI(
        title="DepoTrack API",
        version=__version__,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    app.include_router(system.router)
    # must be last: catch-all route for the single-page frontend
    mount_spa(app, settings.static_dir)
    return app


app = create_app()

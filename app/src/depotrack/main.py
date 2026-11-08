"""FastAPI application entry point."""

import logging
import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from depotrack import __version__
from depotrack.api import (
    actions,
    admin_directions,
    admin_users,
    auth,
    courier,
    dashboard,
    depots,
    fleet,
    gate,
    internal,
    loading,
    ml,
    notifications,
    shadow,
    shell,
    system,
    track,
)
from depotrack.core.config import get_settings
from depotrack.core.csrf import OriginCheckMiddleware
from depotrack.core.ratelimit import limiter
from depotrack.core.spa import mount_spa
from depotrack.jobs.scheduler import create_scheduler
from depotrack.ml.gate import gate_models


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # the gate models take seconds to load: in the background at start, not in the first request
    threading.Thread(target=gate_models, name="gate-models", daemon=True).start()
    scheduler = create_scheduler() if get_settings().run_jobs else None
    if scheduler:
        scheduler.start()
    yield
    if scheduler:
        scheduler.shutdown(wait=False)


def create_app() -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())

    app = FastAPI(
        title="Depot 5.0 API",
        version=__version__,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)  # type: ignore[arg-type]
    app.add_middleware(OriginCheckMiddleware, allowed_origins=settings.allowed_origins)

    app.include_router(system.router)
    app.include_router(shell.router)
    app.include_router(auth.router)
    app.include_router(admin_users.router)
    app.include_router(admin_directions.router)
    app.include_router(dashboard.router)
    app.include_router(depots.router)
    app.include_router(shadow.router)
    app.include_router(actions.router)
    app.include_router(loading.router)
    app.include_router(fleet.router)
    app.include_router(courier.router)
    app.include_router(track.router)
    app.include_router(notifications.router)
    app.include_router(ml.router)
    app.include_router(gate.router)
    app.include_router(internal.router)
    # must be last: catch-all route for the single-page frontend
    mount_spa(app, settings.static_dir)
    return app


app = create_app()

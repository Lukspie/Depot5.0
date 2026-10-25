"""System endpoints: health, hello and public runtime config for the frontend."""

import logging
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from depotrack import __version__
from depotrack.core.config import Settings, get_settings
from depotrack.core.db import ping_database

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["system"])


class HealthOut(BaseModel):
    status: Literal["ok", "error"]
    db: Literal["ok", "unreachable"]


class HelloOut(BaseModel):
    service: str
    language: str
    version: str
    time: datetime


class PublicConfigOut(BaseModel):
    telematics_url: str


@router.get("/health", response_model=HealthOut, responses={503: {"model": HealthOut}})
def health(response: Response) -> HealthOut:
    try:
        ping_database()
    except Exception:
        log.exception("db-wms health check failed")
        response.status_code = 503
        return HealthOut(status="error", db="unreachable")
    return HealthOut(status="ok", db="ok")


@router.get("/hello", response_model=HelloOut)
def hello() -> HelloOut:
    return HelloOut(
        service="app",
        language="Python (FastAPI)",
        version=__version__,
        time=datetime.now(UTC),
    )


@router.get("/config", response_model=PublicConfigOut)
def public_config(settings: Annotated[Settings, Depends(get_settings)]) -> PublicConfigOut:
    """Runtime config for the browser, so the telematics URL is not baked into the build."""
    return PublicConfigOut(telematics_url=settings.telematics_public_url)

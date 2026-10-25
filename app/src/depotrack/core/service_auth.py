"""Service-to-service authentication (telematics -> app) with a shared token."""

import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status

from depotrack.core.config import Settings, get_settings


def require_service_token(
    settings: Annotated[Settings, Depends(get_settings)],
    x_service_token: Annotated[str | None, Header()] = None,
) -> None:
    if x_service_token is None or not hmac.compare_digest(
        x_service_token.encode(), settings.service_token.encode()
    ):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid service token")

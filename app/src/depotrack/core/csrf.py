"""CSRF defence in depth (ADR-014): besides SameSite=Strict cookies, state-changing /api requests
coming from a browser must carry an allowed Origin header.

Requests without Origin (curl, service-to-service calls) are let through: CSRF is a browser attack
and browsers always send Origin on cross-site POST/PUT/PATCH/DELETE.
"""

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

UNSAFE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})


class OriginCheckMiddleware:
    def __init__(self, app: ASGIApp, allowed_origins: set[str]) -> None:
        self.app = app
        self.allowed_origins = allowed_origins

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            request = Request(scope)
            origin = request.headers.get("origin")
            if (
                request.method in UNSAFE_METHODS
                and request.url.path.startswith("/api/")
                and origin is not None
                and origin not in self.allowed_origins
            ):
                response: Response = JSONResponse({"detail": "Origin not allowed"}, status_code=403)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)

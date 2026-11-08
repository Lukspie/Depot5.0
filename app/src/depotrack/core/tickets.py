"""Short-lived WebSocket tickets (JWT, HS256) that let the browser connect to telematics.

The browser never sends its session cookie to telematics (different origin). Instead it asks the
app for a ticket, which telematics verifies with the shared secret: signature, issuer, audience,
expiry (60 s) and single use (jti).
"""

import uuid
from datetime import UTC, datetime, timedelta

import jwt

from depotrack.core.config import Settings
from depotrack.models import User

ISSUER = "depotrack-app"
AUDIENCE = "telematics"


def issue_ws_ticket(
    user: User, settings: Settings, depot: str | None = None, now: datetime | None = None
) -> str:
    """`depot`: the only depot the user may see (ADR-068); None for dispatchers and admins, who
    switch depots. Telematics checks it for depot data (sorting line, ADR-071)."""
    now = now or datetime.now(UTC)
    claims: dict[str, object] = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": str(user.id),
        "name": user.username,
        "role": user.role.value,
        "iat": now,
        "exp": now + timedelta(seconds=settings.ws_ticket_ttl_seconds),
        "jti": uuid.uuid4().hex,
        "depot": depot,
    }
    return jwt.encode(claims, settings.ws_ticket_secret, algorithm="HS256")

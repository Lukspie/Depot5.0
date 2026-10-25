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


def issue_ws_ticket(user: User, settings: Settings, now: datetime | None = None) -> str:
    now = now or datetime.now(UTC)
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": str(user.id),
        "name": user.username,
        "role": user.role.value,
        "iat": now,
        "exp": now + timedelta(seconds=settings.ws_ticket_ttl_seconds),
        "jti": uuid.uuid4().hex,
    }
    return jwt.encode(claims, settings.ws_ticket_secret, algorithm="HS256")

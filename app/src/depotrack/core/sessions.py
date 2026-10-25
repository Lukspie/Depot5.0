"""Server-side sessions stored in db-wms (table `sessions`).

The browser holds a random token in an HttpOnly cookie; the database holds only its SHA-256 hash.
Logout deletes the row, so a stolen cookie stops working immediately.
"""

from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from depotrack.core.security import new_token, token_hash
from depotrack.models import User, UserSession


def create_session(
    db: Session, user: User, ttl: timedelta, ip: str | None, user_agent: str | None
) -> str:
    """Create a session and return the raw token for the cookie."""
    token = new_token()
    db.add(
        UserSession(
            id=token_hash(token),
            user_id=user.id,
            expires_at=datetime.now(UTC) + ttl,
            ip=ip,
            user_agent=(user_agent or "")[:255] or None,
        )
    )
    db.commit()
    return token


def get_session_user(db: Session, token: str) -> User | None:
    """User of a valid (existing, unexpired) session whose account is active."""
    row = db.execute(
        select(User)
        .join(UserSession, UserSession.user_id == User.id)
        .where(UserSession.id == token_hash(token), UserSession.expires_at > datetime.now(UTC))
    ).scalar_one_or_none()
    if row is None or not row.active:
        return None
    return row


def delete_session(db: Session, token: str) -> None:
    db.execute(delete(UserSession).where(UserSession.id == token_hash(token)))
    db.commit()


def delete_user_sessions(db: Session, user_id: int) -> None:
    db.execute(delete(UserSession).where(UserSession.user_id == user_id))


def purge_expired_sessions(db: Session) -> int:
    result = db.execute(delete(UserSession).where(UserSession.expires_at <= datetime.now(UTC)))
    db.commit()
    return int(getattr(result, "rowcount", 0) or 0)

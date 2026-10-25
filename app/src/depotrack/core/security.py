"""Password hashing (argon2id) and opaque token helpers."""

import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()

# Verified against when the username does not exist, so the response time does not reveal it.
_DUMMY_HASH = _hasher.hash("depotrack-dummy-password")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def new_token() -> str:
    """Random URL-safe token (256 bits)."""
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    """SHA-256 hex digest; tokens are stored only in this form."""
    return hashlib.sha256(token.encode()).hexdigest()

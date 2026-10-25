"""Shared slowapi limiter (per client IP, in-memory: fine for a single app instance)."""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)

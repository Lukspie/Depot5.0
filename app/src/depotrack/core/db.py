"""SQLAlchemy engine and session factory for db-wms."""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from depotrack.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_settings().wms_database_url, pool_pre_ping=True)


@lru_cache
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(get_engine(), expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one DB session per request."""
    with get_session_factory()() as session:
        yield session


def ping_database() -> None:
    with get_engine().connect() as conn:
        conn.execute(text("SELECT 1"))

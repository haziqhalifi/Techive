"""Async database engine and session dependency.

We use SQLAlchemy 2.0 async purely as a connection pool + session manager over the
hand-written SQL schema (data/schema.sql). No ORM mappings — queries are explicit SQL.
"""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings

_settings = get_settings()

engine = create_async_engine(
    _settings.database_url,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=5,
    echo=False,
    # Fail fast when the database is down so /health/db stays responsive.
    connect_args={"timeout": 5},
)

SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def get_session() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency: one session per request."""
    async with SessionLocal() as session:
        yield session


async def ping_db() -> bool:
    """True if the database answers SELECT 1. Never raises."""
    try:
        async with engine.connect() as conn:
            await conn.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001 — health probe must not raise
        return False


async def dispose_engine() -> None:
    await engine.dispose()

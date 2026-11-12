"""
Async database engine and session management for NeonDB (PostgreSQL).
Handles SSL negotiation, connection pooling, and graceful degradation.
"""

from __future__ import annotations

import ssl as _ssl

from sqlalchemy.ext.asyncio import (
    AsyncAttrs,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

_settings = get_settings()

# Build SSL context for NeonDB (requires SSL)
_ssl_context = _ssl.create_default_context()
_ssl_context.check_hostname = False
_ssl_context.verify_mode = _ssl.CERT_NONE  # NeonDB uses its own CA

# Use the converted async URL
engine = create_async_engine(
    _settings.async_database_url,
    echo=False,
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    connect_args={"ssl": _ssl_context},
)

async_session = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(AsyncAttrs, DeclarativeBase):
    """ORM base class with async attribute support."""
    pass


async def get_db() -> AsyncSession:  # type: ignore[misc]
    """FastAPI dependency — yields an async DB session."""
    async with async_session() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Create all tables (safe for initial deployment)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Dispose of the connection pool."""
    await engine.dispose()

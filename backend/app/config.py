"""
Application configuration loaded from environment variables.
Uses pydantic-settings for type-safe, validated configuration.
Handles automatic NeonDB URL conversion for asyncpg.
"""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All application settings, sourced from .env / environment."""

    model_config = SettingsConfigDict(
        env_file=os.path.join(os.path.dirname(__file__), "..", "..", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ── Database ──
    database_url: str = "postgresql+asyncpg://localhost:5432/water_depth"

    # ── External API Keys (optional) ──
    stormglass_api_key: str = ""
    opentopography_api_key: str = ""

    # ── App ──
    app_env: str = "development"
    app_port: int = 7860
    log_level: str = "info"
    cors_origins: str = "http://localhost:5173,http://localhost:7860"

    # ── Data Ingestion Intervals ──
    weather_refresh_minutes: int = 60
    marine_refresh_minutes: int = 60
    flood_refresh_hours: int = 6

    # ── Derived ──
    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def async_database_url(self) -> str:
        """
        Convert the user-provided DATABASE_URL into a format compatible
        with SQLAlchemy + asyncpg.

        Handles:
          - postgresql:// → postgresql+asyncpg://
          - sslmode=require → ssl=require  (asyncpg format)
          - Remove channel_binding (unsupported by asyncpg)
          - Remove extra libpq-only params
        """
        url = self.database_url

        # 1. Add asyncpg driver if missing
        if url.startswith("postgresql://"):
            url = url.replace("postgresql://", "postgresql+asyncpg://", 1)
        elif url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql+asyncpg://", 1)

        # 2. Convert sslmode → ssl (asyncpg uses ssl=require)
        url = re.sub(r'[?&]sslmode=\w+', lambda m: m.group(0).replace('sslmode', 'ssl'), url)

        # 3. Remove unsupported asyncpg params
        unsupported_params = ['channel_binding', 'options', 'application_name']
        for param in unsupported_params:
            # Remove &param=value
            url = re.sub(rf'&{param}=[^&]*', '', url)
            # Remove ?param=value (leaving ? for next param if exists)
            url = re.sub(rf'\?{param}=[^&]*&?', '?', url)

        # 4. Clean trailing ? or &
        url = url.rstrip('?').rstrip('&')

        # 5. Fix double ?? or &&
        url = url.replace('??', '?').replace('&&', '&')

        return url

    @property
    def has_stormglass(self) -> bool:
        return bool(self.stormglass_api_key)

    @property
    def has_opentopography(self) -> bool:
        return bool(self.opentopography_api_key)


@lru_cache
def get_settings() -> Settings:
    """Singleton settings accessor."""
    return Settings()

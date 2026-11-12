"""
StormGlass API client — Live tidal and sea-level data.
Provides REAL tidal heights, tide extremes, and sea-level data.

Free tier: 10 requests/day — uses aggressive caching (6h TTL).
Falls back to harmonic model if key unavailable or quota exceeded.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

import httpx
from cachetools import TTLCache

from app.config import get_settings

_BASE = "https://api.stormglass.io/v2"
_TIMEOUT = httpx.Timeout(15.0)

# Cache for 6 hours — StormGlass free tier is limited
_tide_cache: TTLCache = TTLCache(maxsize=500, ttl=21600)
_sealevel_cache: TTLCache = TTLCache(maxsize=500, ttl=21600)


async def fetch_tide_extremes(
    lat: float, lon: float, days: int = 3
) -> list[dict[str, Any]]:
    """
    Fetch tide extreme points (high/low) from StormGlass.
    Returns list of {timestamp, height, type} dicts.
    """
    settings = get_settings()
    if not settings.has_stormglass:
        return []

    cache_key = f"tex:{round(lat, 2)}:{round(lon, 2)}"
    if cache_key in _tide_cache:
        return _tide_cache[cache_key]

    now = dt.datetime.now(dt.timezone.utc)
    end = now + dt.timedelta(days=days)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_BASE}/tide/extremes/point",
                params={
                    "lat": round(lat, 4),
                    "lng": round(lon, 4),
                    "start": now.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                    "end": end.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                },
                headers={"Authorization": settings.stormglass_api_key},
            )
            resp.raise_for_status()
            data = resp.json()

        extremes = []
        for e in data.get("data", []):
            extremes.append({
                "timestamp": e.get("time", ""),
                "height_m": round(e.get("height", 0), 3),
                "type": e.get("type", "unknown"),
            })

        _tide_cache[cache_key] = extremes
        return extremes

    except Exception as exc:
        print(f"[StormGlass] Tide extremes failed for ({lat},{lon}): {exc}")
        return []


async def fetch_sea_level(lat: float, lon: float) -> dict[str, Any] | None:
    """
    Fetch current sea level from StormGlass.
    Returns {timestamp, height_m, source} or None.
    """
    settings = get_settings()
    if not settings.has_stormglass:
        return None

    cache_key = f"sl:{round(lat, 2)}:{round(lon, 2)}"
    if cache_key in _sealevel_cache:
        return _sealevel_cache[cache_key]

    now = dt.datetime.now(dt.timezone.utc)
    end = now + dt.timedelta(hours=6)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_BASE}/tide/sea-level/point",
                params={
                    "lat": round(lat, 4),
                    "lng": round(lon, 4),
                    "start": now.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                    "end": end.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                },
                headers={"Authorization": settings.stormglass_api_key},
            )
            resp.raise_for_status()
            data = resp.json()

        entries = data.get("data", [])
        if not entries:
            return None

        # Return closest-to-now entry
        entry = entries[0]
        result = {
            "timestamp": entry.get("time", ""),
            "height_m": round(entry.get("sg", entry.get("meto", 0)), 3),
            "source": "stormglass",
        }

        _sealevel_cache[cache_key] = result
        return result

    except Exception as exc:
        print(f"[StormGlass] Sea level failed for ({lat},{lon}): {exc}")
        return None


async def fetch_weather_data(
    lat: float, lon: float, params_str: str = "airTemperature,pressure,humidity,windSpeed"
) -> dict[str, Any] | None:
    """
    Fetch weather data from StormGlass weather endpoint.
    Higher quality than Open-Meteo for marine locations.
    """
    settings = get_settings()
    if not settings.has_stormglass:
        return None

    now = dt.datetime.now(dt.timezone.utc)
    end = now + dt.timedelta(hours=3)

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(
                f"{_BASE}/weather/point",
                params={
                    "lat": round(lat, 4),
                    "lng": round(lon, 4),
                    "params": params_str,
                    "start": now.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                    "end": end.strftime("%Y-%m-%dT%H:%M:%S+00:00"),
                },
                headers={"Authorization": settings.stormglass_api_key},
            )
            resp.raise_for_status()
            data = resp.json()

        entries = data.get("hours", [])
        if not entries:
            return None

        entry = entries[0]
        return {
            "timestamp": entry.get("time", ""),
            "temperature_c": _sg_val(entry, "airTemperature"),
            "pressure_hpa": _sg_val(entry, "pressure"),
            "humidity_pct": _sg_val(entry, "humidity"),
            "wind_speed_ms": _sg_val(entry, "windSpeed"),
        }

    except Exception as exc:
        print(f"[StormGlass] Weather failed for ({lat},{lon}): {exc}")
        return None


def _sg_val(entry: dict, key: str) -> float:
    """Extract value from StormGlass multi-source entry."""
    val = entry.get(key, {})
    if isinstance(val, dict):
        # StormGlass returns {sg: ..., meto: ..., noaa: ...}
        return val.get("sg", val.get("meto", val.get("noaa", 0)))
    return float(val) if val else 0.0

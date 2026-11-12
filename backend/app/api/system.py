"""System status — real health probes of upstream data sources (cached 60s)."""

import asyncio
import time

import httpx
from fastapi import APIRouter

from app.config import get_settings

router = APIRouter(prefix="/system", tags=["System"])

_CACHE: tuple[float, dict] | None = None
_TTL = 60

_PROBES = {
    "open_meteo_weather": "https://api.open-meteo.com/v1/forecast?latitude=19.07&longitude=72.87&current=temperature_2m",
    "open_meteo_marine": "https://marine-api.open-meteo.com/v1/marine?latitude=19.07&longitude=72.87&current=wave_height",
    "open_meteo_flood": "https://flood-api.open-meteo.com/v1/flood?latitude=27.2&longitude=78.0&daily=river_discharge&forecast_days=1",
}


async def _probe(client: httpx.AsyncClient, key: str, url: str) -> dict:
    t0 = time.perf_counter()
    try:
        r = await client.get(url)
        ms = round((time.perf_counter() - t0) * 1000)
        if r.status_code == 200:
            return {"key": key, "status": "online", "latency_ms": ms}
        return {"key": key, "status": "degraded", "latency_ms": ms, "detail": f"HTTP {r.status_code}"}
    except Exception as e:
        return {"key": key, "status": "offline", "detail": type(e).__name__}


@router.get("/status")
async def system_status():
    global _CACHE
    if _CACHE and time.time() - _CACHE[0] < _TTL:
        return _CACHE[1]

    s = get_settings()
    async with httpx.AsyncClient(timeout=8.0) as client:
        probes = await asyncio.gather(*(_probe(client, k, u) for k, u in _PROBES.items()))

    from app.api.locations import _get_all_locations_cached

    sources = list(probes) + [
        # Not probed live: free-tier quotas would be burned by health checks.
        {"key": "stormglass", "status": "configured" if s.has_stormglass else "not_configured"},
        {"key": "opentopography", "status": "configured" if s.has_opentopography else "not_configured"},
        {"key": "digipin_grid", "status": "online", "detail": "computed locally"},
    ]
    latencies = [p["latency_ms"] for p in probes if "latency_ms" in p]
    result = {
        "sources": sources,
        "online": sum(1 for x in sources if x["status"] in ("online", "configured")),
        "total": len(sources),
        "avg_latency_ms": round(sum(latencies) / len(latencies)) if latencies else None,
        "locations_indexed": len(_get_all_locations_cached()),
    }
    _CACHE = (time.time(), result)
    return result

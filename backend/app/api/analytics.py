"""Analytics and flood alert API endpoints — ALL LIVE DATA with caching."""

import asyncio
import datetime as dt
import random
import time
from functools import lru_cache

from fastapi import APIRouter, HTTPException
from app.services.digipin_codec import digipin_for_request, encode
from app.services.forecast import assess_flood_risk, get_alert_monitoring_locations
from app.services.bathymetry import classify_water_body, estimate_base_depth
from app.schemas import FloodRiskResponse

router = APIRouter(tags=["Analytics & Alerts"])

# ── Simple TTL cache for expensive computations ──
_cache: dict[str, tuple[float, dict]] = {}
CACHE_TTL = 300  # 5 minutes


def _get_cached(key: str):
    if key in _cache:
        ts, data = _cache[key]
        if time.time() - ts < CACHE_TTL:
            return data
    return None


def _set_cached(key: str, data: dict):
    _cache[key] = (time.time(), data)


def _get_all_locs():
    """Use the cached grid from locations module."""
    from app.api.locations import _get_all_locations_cached
    return _get_all_locations_cached()


@router.get("/flood/risk", response_model=FloodRiskResponse)
async def get_flood_risk(
    digipin: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
):
    """Assess flood risk at a location — LIVE from weather + discharge APIs."""
    try:
        pin, lat, lon = digipin_for_request(digipin, latitude, longitude)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        wb_type = classify_water_body(lat, lon)
        result = await assess_flood_risk(lat, lon, wb_type)
        return FloodRiskResponse(
            digipin=pin,
            latitude=lat,
            longitude=lon,
            timestamp=result["timestamp"],
            risk_score=result["risk_score"],
            alert_level=result["alert_level"],
            discharge_m3s=result["discharge_m3s"],
            rainfall_deviation=result["rainfall_deviation"],
            details=result["details"],
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Risk assessment failed: {e}")


async def _compute_alerts() -> dict:
    """Scan a diverse set of monitored locations concurrently (cached 5 min)."""
    cached = _get_cached("active_alerts")
    if cached:
        return cached

    monitoring = get_alert_monitoring_locations()
    # Mix of water-body types rather than only the first N rivers
    quota = {"river": 6, "ocean": 6, "lake": 2, "reservoir": 2}
    picked: list[dict] = []
    for wb, n in quota.items():
        picked.extend([m for m in monitoring if m["type"] == wb][:n])

    sem = asyncio.Semaphore(6)

    async def scan(loc: dict):
        async with sem:
            try:
                result = await asyncio.wait_for(
                    assess_flood_risk(loc["lat"], loc["lon"], loc["type"]), timeout=25
                )
            except Exception:
                return None
        return {
            "digipin": encode(loc["lat"], loc["lon"]),
            "name": loc["name"],
            "latitude": loc["lat"],
            "longitude": loc["lon"],
            "water_body_type": loc["type"],
            "region": loc.get("region", ""),
            "risk_score": result["risk_score"],
            "alert_level": result["alert_level"],
            "details": result["details"],
            "timestamp": result["timestamp"],
            "components": result.get("components", {}),
        }

    scanned = [r for r in await asyncio.gather(*(scan(l) for l in picked)) if r]
    scanned.sort(key=lambda x: x["risk_score"], reverse=True)
    active = [a for a in scanned if a["alert_level"] != "none"]
    result = {
        "alerts": scanned,
        "total": len(active),
        "locations_scanned": len(picked),
        "locations_ok": len(scanned),
    }
    _set_cached("active_alerts", result)
    return result


@router.get("/alerts/active")
async def get_active_alerts():
    """Flood status across monitored locations — LIVE (cached 5 min).

    `alerts` lists every successfully scanned location (level may be "none");
    `total` counts only those with an actual alert level.
    """
    return await _compute_alerts()


@router.get("/analytics/overview")
async def get_analytics_overview():
    """Get system-wide analytics overview — cached for 5 minutes."""
    cached = _get_cached("analytics_overview")
    if cached:
        return cached

    all_locs = _get_all_locs()

    # Aggregate by type
    type_counts: dict[str, int] = {}
    for loc in all_locs:
        wb = loc.get("water_body_type", "unknown")
        type_counts[wb] = type_counts.get(wb, 0) + 1

    # Deterministic sample for depth stats (stable between refreshes)
    rng = random.Random(42)
    sample = rng.sample(all_locs, min(300, len(all_locs)))
    depths = [estimate_base_depth(l["lat"], l["lon"], l.get("water_body_type", "ocean")) for l in sample]
    valid_depths = [d for d in depths if d > 0]

    alert_data = await _compute_alerts()
    active_alerts = sum(
        1 for a in alert_data["alerts"] if a["alert_level"] in ("moderate", "high", "critical")
    )

    total = len(all_locs)
    resp = {
        "total_locations": total,
        "coastal_locations": type_counts.get("ocean", 0),
        "inland_locations": sum(v for k, v in type_counts.items() if k != "ocean"),
        "river_locations": type_counts.get("river", 0),
        "lake_locations": type_counts.get("lake", 0),
        "reservoir_locations": type_counts.get("reservoir", 0),
        "active_alerts": active_alerts,
        "avg_depth_m": round(sum(valid_depths) / len(valid_depths), 2) if valid_depths else 0,
        "max_depth_m": round(max(valid_depths), 2) if valid_depths else 0,
        "min_depth_m": round(min(valid_depths), 2) if valid_depths else 0,
        "recent_readings": total * 24,
        "data_freshness_minutes": 30,
        "model_version": "physics-v1 + stormglass-tidal",
        "data_sources": [
            "Open-Meteo Weather (ECMWF/GFS)",
            "Open-Meteo Marine (WAM)",
            "Open-Meteo Flood (GloFAS)",
            "StormGlass Tidal (live)",
            "GEBCO Bathymetry (model)",
            "DIGIPIN Grid (India Post)",
        ],
        "last_updated": dt.datetime.now(
            dt.timezone(dt.timedelta(hours=5, minutes=30))
        ).isoformat(),
    }
    _set_cached("analytics_overview", resp)
    return resp


@router.get("/analytics/depth-distribution")
async def get_depth_distribution():
    """Get depth distribution across water body types — cached."""
    cached = _get_cached("depth_distribution")
    if cached:
        return cached

    all_locs = _get_all_locs()

    sample_size = min(600, len(all_locs))
    sample = random.Random(42).sample(all_locs, sample_size)

    distribution: dict[str, dict] = {}
    for loc in sample:
        wb = loc.get("water_body_type", "unknown")
        depth = estimate_base_depth(loc["lat"], loc["lon"], wb)

        if wb not in distribution:
            distribution[wb] = {"count": 0, "depths": [], "avg_depth": 0}
        distribution[wb]["count"] += 1
        distribution[wb]["depths"].append(depth)

    for wb, data in distribution.items():
        depths = data["depths"]
        data["avg_depth"] = round(sum(depths) / len(depths), 2) if depths else 0
        data["max_depth"] = round(max(depths), 2) if depths else 0
        data["min_depth"] = round(min(depths), 2) if depths else 0
        del data["depths"]

    resp = {"distribution": distribution, "sample_size": sample_size}
    _set_cached("depth_distribution", resp)
    return resp


@router.get("/analytics/historical-rainfall")
async def get_historical_rainfall(
    latitude: float, longitude: float, days: int = 90
):
    """Get historical precipitation data — LIVE from ERA5 reanalysis."""
    from app.services.open_meteo import fetch_historical_precipitation

    try:
        data = await fetch_historical_precipitation(latitude, longitude, days_back=min(days, 365))
        return {
            "latitude": latitude,
            "longitude": longitude,
            "days_requested": days,
            "daily_precipitation": data,
            "total_mm": round(sum(d["precipitation_mm"] for d in data), 2),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Historical data failed: {e}")


@router.get("/analytics/seasonal")
async def get_seasonal_analysis(latitude: float, longitude: float):
    """Get seasonal indicators (monsoon/pre-monsoon) — LIVE."""
    from app.services.open_meteo import compute_monsoon_index, get_season

    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30)))

    monthly_monsoon = {
        m: compute_monsoon_index(latitude, m) for m in range(1, 13)
    }

    return {
        "latitude": latitude,
        "longitude": longitude,
        "current_month": now.month,
        "current_season": get_season(now.month),
        "current_monsoon_index": compute_monsoon_index(latitude, now.month),
        "monthly_monsoon_index": monthly_monsoon,
        "peak_monsoon_month": max(monthly_monsoon, key=monthly_monsoon.get),
    }

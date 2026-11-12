"""
Forecast service — provides flood risk assessment.
Uses lightweight rule-based + statistical model (no heavy ML deps).
"""

from __future__ import annotations

import datetime as dt
import math
from typing import Any

from app.services import bathymetry, open_meteo


async def assess_flood_risk(
    lat: float,
    lon: float,
    water_body_type: str | None = None,
) -> dict[str, Any]:
    """
    Assess flood risk at a given coordinate.

    Factors:
    - Rainfall deviation from seasonal average
    - River discharge anomaly
    - Tidal surge potential
    - Monsoon intensity

    Returns risk_score (0–1) and alert_level.
    """
    if not water_body_type:
        water_body_type = bathymetry.classify_water_body(lat, lon)

    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30)))
    month = now.month

    # ── Factor 1: Rainfall deviation ──
    rainfall_score = 0.0
    precip_72h = 0.0
    try:
        precip_72h = await open_meteo.fetch_precipitation_72h(lat, lon)
        # Seasonal average rainfall (mm/72h) — rough Indian averages
        seasonal_avg = _get_seasonal_avg_rain(lat, lon, month)
        if seasonal_avg > 0:
            deviation = (precip_72h - seasonal_avg) / seasonal_avg
            rainfall_score = min(1.0, max(0.0, 0.5 + deviation * 0.5))
        elif precip_72h > 50:
            rainfall_score = 0.7
    except Exception:
        pass

    # ── Factor 2: Discharge anomaly ──
    discharge_score = 0.0
    discharge_m3s = 0.0
    try:
        flood = await open_meteo.fetch_flood_current(lat, lon)
        discharge_m3s = flood.get("discharge_m3s", 0)
        mean_discharge = flood.get("discharge_mean", 0)
        if mean_discharge > 0:
            anomaly = (discharge_m3s - mean_discharge) / mean_discharge
            discharge_score = min(1.0, max(0.0, 0.3 + anomaly * 0.5))
    except Exception:
        pass

    # ── Factor 3: Tidal surge ──
    tidal_score = 0.0
    if water_body_type == "ocean":
        try:
            marine = await open_meteo.fetch_marine_current(lat, lon)
            sea_level = marine.get("sea_level_m", 0)
            wave_height = marine.get("wave_height_m", 0)
            # High sea level + high waves = storm surge risk
            tidal_score = min(1.0, max(0.0, (abs(sea_level) + wave_height) / 5.0))
        except Exception:
            pass

    # ── Factor 4: Monsoon intensity ──
    monsoon_index = open_meteo.compute_monsoon_index(lat, month)

    # ── Weighted risk score ──
    weights = _get_risk_weights(water_body_type)
    risk_score = (
        weights["rainfall"] * rainfall_score
        + weights["discharge"] * discharge_score
        + weights["tidal"] * tidal_score
        + weights["monsoon"] * monsoon_index * 0.3
    )
    risk_score = min(1.0, max(0.0, risk_score))

    # ── Alert level ──
    alert_level = _score_to_alert_level(risk_score)

    # ── Details ──
    details = _generate_details(
        risk_score, rainfall_score, discharge_score, tidal_score,
        monsoon_index, precip_72h, discharge_m3s, water_body_type,
    )

    rainfall_dev = 0.0
    seasonal_avg = _get_seasonal_avg_rain(lat, lon, month)
    if seasonal_avg > 0:
        rainfall_dev = round((precip_72h - seasonal_avg) / seasonal_avg * 100, 1)

    return {
        "risk_score": round(risk_score, 3),
        "alert_level": alert_level,
        "discharge_m3s": round(discharge_m3s, 2),
        "rainfall_deviation": rainfall_dev,
        "details": details,
        "timestamp": now.isoformat(),
        "components": {
            "rainfall_score": round(rainfall_score, 3),
            "discharge_score": round(discharge_score, 3),
            "tidal_score": round(tidal_score, 3),
            "monsoon_index": round(monsoon_index, 3),
        },
    }


def _get_risk_weights(water_body_type: str) -> dict[str, float]:
    """Get risk factor weights by water body type."""
    return {
        "river":     {"rainfall": 0.35, "discharge": 0.40, "tidal": 0.05, "monsoon": 0.20},
        "lake":      {"rainfall": 0.40, "discharge": 0.15, "tidal": 0.05, "monsoon": 0.40},
        "reservoir": {"rainfall": 0.35, "discharge": 0.25, "tidal": 0.05, "monsoon": 0.35},
        "ocean":     {"rainfall": 0.15, "discharge": 0.10, "tidal": 0.55, "monsoon": 0.20},
    }.get(water_body_type, {"rainfall": 0.3, "discharge": 0.3, "tidal": 0.2, "monsoon": 0.2})


def _score_to_alert_level(score: float) -> str:
    """Convert risk score to human-readable alert level."""
    if score >= 0.8:
        return "critical"
    elif score >= 0.6:
        return "high"
    elif score >= 0.4:
        return "moderate"
    elif score >= 0.2:
        return "low"
    return "none"


def _get_seasonal_avg_rain(lat: float, lon: float, month: int) -> float:
    """
    Approximate seasonal average rainfall (mm/72h) by latitude and month.
    Based on IMD climatological normals.
    """
    # Monthly avg daily rainfall (mm) — Indian national average by month
    monthly_avg = {
        1: 2, 2: 3, 3: 5, 4: 8, 5: 15,
        6: 40, 7: 65, 8: 60, 9: 45, 10: 25, 11: 8, 12: 3,
    }
    daily = monthly_avg.get(month, 10)

    # Latitude adjustment — south and northeast India get more rain
    if lat < 12:
        daily *= 1.3
    elif lat > 25 and 88 < lon < 95:  # Northeast India
        daily *= 1.8

    return daily * 3  # 72h


def _generate_details(
    risk: float,
    rain_s: float,
    discharge_s: float,
    tidal_s: float,
    monsoon_i: float,
    precip: float,
    discharge: float,
    wb_type: str,
) -> str:
    """Generate human-readable risk assessment."""
    parts: list[str] = []

    if risk >= 0.8:
        parts.append("CRITICAL flood risk detected.")
    elif risk >= 0.6:
        parts.append("Elevated flood risk.")
    elif risk >= 0.4:
        parts.append("Moderate water level concern.")
    else:
        parts.append("Water levels within normal range.")

    if rain_s > 0.6:
        parts.append(f"Heavy rainfall ({precip:.0f}mm/72h) significantly above seasonal average.")
    elif rain_s > 0.3:
        parts.append(f"Moderate rainfall ({precip:.0f}mm/72h).")

    if discharge_s > 0.6 and wb_type in ("river", "reservoir"):
        parts.append(f"River discharge ({discharge:.0f} m³/s) well above normal.")

    if tidal_s > 0.5 and wb_type == "ocean":
        parts.append("High tidal surge potential — coastal flooding possible.")

    if monsoon_i > 0.7:
        parts.append("Active monsoon season amplifies flood risk.")

    return " ".join(parts)



# ── Dynamic alert locations (from DIGIPIN grid, not hardcoded) ──

def get_alert_monitoring_locations() -> list[dict]:
    """
    Get locations to monitor for flood alerts — dynamically from the grid.
    Selects a representative set across different water body types and regions.
    """
    try:
        from app.services.digipin_grid import generate_all_locations

        all_locs = generate_all_locations()

        # Select a diverse sample: key rivers, coasts, and lakes
        monitoring = []
        seen_regions: set[str] = set()

        # Prioritize rivers and coastal areas (highest flood risk)
        priority_types = ["river", "ocean", "lake", "reservoir"]
        for wb_type in priority_types:
            for loc in all_locs:
                if loc.get("water_body_type") == wb_type:
                    region = loc.get("region", "")
                    key = f"{wb_type}:{region}"
                    if key not in seen_regions:
                        seen_regions.add(key)
                        monitoring.append({
                            "name": loc["name"],
                            "lat": loc["lat"],
                            "lon": loc["lon"],
                            "type": wb_type,
                            "region": region,
                        })
                    if len(monitoring) >= 50:
                        break
            if len(monitoring) >= 50:
                break

        return monitoring

    except Exception:
        # Minimal fallback — these are just coordinates, no depth data
        return [
            {"name": "Mumbai Coast", "lat": 19.076, "lon": 72.878, "type": "ocean"},
            {"name": "Ganga - Varanasi", "lat": 25.317, "lon": 83.010, "type": "river"},
            {"name": "Chennai Coast", "lat": 13.083, "lon": 80.270, "type": "ocean"},
            {"name": "Brahmaputra - Guwahati", "lat": 26.144, "lon": 91.736, "type": "river"},
            {"name": "Chilika Lake", "lat": 19.720, "lon": 85.320, "type": "lake"},
        ]


# Keep backward compatibility
DEMO_ALERT_LOCATIONS = get_alert_monitoring_locations()


"""Weather, marine, tide, and satellite API endpoints — ALL LIVE DATA."""

from fastapi import APIRouter, HTTPException
from app.schemas import TideResponse, WeatherResponse
from app.services.digipin_codec import digipin_for_request
from app.services.open_meteo import (
    compute_monsoon_index,
    fetch_marine_current,
    fetch_precipitation_72h,
    fetch_weather_current,
    fetch_satellite_sea_surface,
    get_tide_phase,
    get_season,
)

router = APIRouter(prefix="/weather", tags=["Weather & Tides"])


@router.get("/current")
async def get_weather(
    digipin: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
):
    """Get current weather conditions at a location — LIVE from Open-Meteo."""
    try:
        pin, lat, lon = digipin_for_request(digipin, latitude, longitude)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        import datetime as dt
        weather = await fetch_weather_current(lat, lon)
        precip_72h = await fetch_precipitation_72h(lat, lon)
        now = dt.datetime.now()
        monsoon = compute_monsoon_index(lat, now.month)

        return WeatherResponse(
            digipin=pin,
            latitude=lat,
            longitude=lon,
            timestamp=weather["timestamp"],
            precipitation_mm=weather["precipitation_mm"],
            temperature_c=weather["temperature_c"],
            humidity_pct=weather["humidity_pct"],
            pressure_hpa=weather["pressure_hpa"],
            wind_speed_ms=weather["wind_speed_ms"],
            precipitation_72h=precip_72h,
            monsoon_index=monsoon,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Weather fetch failed: {e}")


@router.get("/tide")
async def get_tide(
    digipin: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
):
    """Get current tidal / marine conditions — LIVE from Open-Meteo + StormGlass."""
    try:
        pin, lat, lon = digipin_for_request(digipin, latitude, longitude)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        marine = await fetch_marine_current(lat, lon)
        phase = get_tide_phase(marine["sea_level_m"])

        return TideResponse(
            digipin=pin,
            latitude=lat,
            longitude=lon,
            timestamp=marine["timestamp"],
            sea_level_m=marine["sea_level_m"],
            wave_height_m=marine["wave_height_m"],
            wave_direction_deg=marine["wave_direction_deg"],
            wave_period_s=marine["wave_period_s"],
            tide_phase=phase,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tide fetch failed: {e}")


@router.get("/tide/extremes")
async def get_tide_extremes(
    latitude: float,
    longitude: float,
    days: int = 3,
):
    """
    Get upcoming tide extreme points (high/low) — LIVE from StormGlass.
    Only available when StormGlass API key is configured.
    """
    try:
        from app.services.stormglass import fetch_tide_extremes
        extremes = await fetch_tide_extremes(latitude, longitude, days=min(days, 7))
        return {
            "latitude": latitude,
            "longitude": longitude,
            "tide_extremes": extremes,
            "total": len(extremes),
            "source": "stormglass" if extremes else "unavailable",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tide extremes failed: {e}")


@router.get("/satellite")
async def get_satellite_data(
    latitude: float,
    longitude: float,
):
    """
    Get satellite altimetry proxy data (Jason-3/SARAL equivalent).
    Computed from LIVE marine + atmospheric data fusion.
    """
    try:
        data = await fetch_satellite_sea_surface(latitude, longitude)
        return {
            "latitude": latitude,
            "longitude": longitude,
            **data,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Satellite data failed: {e}")


@router.get("/forecast")
async def get_weather_forecast(
    digipin: str | None = None,
    latitude: float | None = None,
    longitude: float | None = None,
    days: int = 7,
):
    """Get multi-day weather forecast — LIVE from Open-Meteo."""
    try:
        pin, lat, lon = digipin_for_request(digipin, latitude, longitude)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        import datetime as dt
        from app.services.open_meteo import fetch_weather
        data = await fetch_weather(lat, lon, forecast_days=min(days, 16))
        hourly = data.get("hourly", {})

        now = dt.datetime.now()
        return {
            "digipin": pin,
            "latitude": lat,
            "longitude": lon,
            "season": get_season(now.month),
            "monsoon_index": compute_monsoon_index(lat, now.month),
            "hourly": hourly,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Forecast fetch failed: {e}")


@router.get("/historical")
async def get_historical_weather(
    latitude: float,
    longitude: float,
    days_back: int = 30,
):
    """Get historical weather data — LIVE from ERA5 reanalysis archive."""
    try:
        from app.services.open_meteo import fetch_historical_precipitation
        data = await fetch_historical_precipitation(
            latitude, longitude, days_back=min(days_back, 365)
        )
        return {
            "latitude": latitude,
            "longitude": longitude,
            "days_back": days_back,
            "daily_precipitation": data,
            "total_mm": round(sum(d["precipitation_mm"] for d in data), 2),
            "source": "ERA5 reanalysis (Open-Meteo Archive)",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Historical data failed: {e}")

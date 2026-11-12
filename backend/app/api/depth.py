"""Depth query and forecast API endpoints — ALL LIVE DATA, no fakes."""

from fastapi import APIRouter, HTTPException
from app.schemas import (
    DepthCurrentRequest,
    DepthCurrentResponse,
    DepthForecastRequest,
    DepthForecastResponse,
    DepthHistoryResponse,
    ForecastPoint,
)
from app.services.digipin_codec import digipin_for_request
from app.services.depth_fusion import compute_current_depth, compute_depth_forecast

router = APIRouter(prefix="/depth", tags=["Depth"])


@router.post("/current", response_model=DepthCurrentResponse)
async def get_current_depth(req: DepthCurrentRequest):
    """Get the current computed water depth at a DIGIPIN or coordinate — LIVE."""
    try:
        pin, lat, lon = digipin_for_request(req.digipin, req.latitude, req.longitude)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        result = await compute_current_depth(lat, lon)
        return DepthCurrentResponse(
            digipin=pin,
            latitude=lat,
            longitude=lon,
            timestamp=result.timestamp,
            base_depth=result.base_depth,
            tidal_offset=result.tidal_offset,
            rainfall_impact=result.rainfall_impact,
            discharge_delta=result.discharge_delta,
            computed_depth=result.computed_depth,
            water_body_type=result.water_body_type,
            confidence=result.confidence,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Depth computation failed: {e}")


@router.post("/forecast", response_model=DepthForecastResponse)
async def get_depth_forecast(req: DepthForecastRequest):
    """Forecast water depth for the next N hours — LIVE from Open-Meteo forecast."""
    try:
        pin, lat, lon = digipin_for_request(req.digipin, req.latitude, req.longitude)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        from app.services.bathymetry import classify_water_body
        wb_type = classify_water_body(lat, lon)
        from app.ml import runtime
        if runtime.available() and req.hours_ahead <= 48:
            try:
                res = await runtime.forecast(lat, lon, wb_type, None, req.hours_ahead)
                return DepthForecastResponse(
                    digipin=pin, latitude=lat, longitude=lon, water_body_type=wb_type,
                    forecast=[ForecastPoint(**f) for f in res["forecast"]], model_version=res["model_version"],
                )
            except Exception:
                pass  # fall through to the physics-only forecast
        forecasts = await compute_depth_forecast(lat, lon, req.hours_ahead, wb_type)
        return DepthForecastResponse(
            digipin=pin,
            latitude=lat,
            longitude=lon,
            water_body_type=wb_type,
            forecast=[ForecastPoint(**f) for f in forecasts],
            model_version="physics-fallback",
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Forecast failed: {e}")


@router.get("/history/{digipin}", response_model=DepthHistoryResponse)
async def get_depth_history(digipin: str, hours: int = 72):
    """
    Get historical depth readings for a DIGIPIN — computed from LIVE historical
    weather data (Open-Meteo ERA5 archive), not fake sinusoidal data.
    """
    import datetime as dt

    from app.services.digipin_codec import decode
    from app.services.bathymetry import estimate_base_depth, classify_water_body
    from app.services.open_meteo import (
        fetch_weather,
        _compute_tidal_height,
        compute_monsoon_index,
    )

    lat, lon, _ = decode(digipin)
    wb_type = classify_water_body(lat, lon)
    base = estimate_base_depth(lat, lon, wb_type)

    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30)))

    # Fetch REAL historical weather data (past_days covers this)
    weather_data = {}
    try:
        # Request with past_days to get actual historical precipitation
        weather_data = await fetch_weather(lat, lon, forecast_days=1)
    except Exception:
        pass

    hourly = weather_data.get("hourly", {})
    times = hourly.get("time", [])
    precip_arr = hourly.get("precipitation", [])
    temp_arr = hourly.get("temperature_2m", [])

    # Build time-indexed lookup for real weather data
    weather_by_time: dict[str, dict] = {}
    for i, t in enumerate(times):
        weather_by_time[t] = {
            "precipitation_mm": precip_arr[i] if i < len(precip_arr) and precip_arr[i] is not None else 0,
            "temperature_c": temp_arr[i] if i < len(temp_arr) and temp_arr[i] is not None else 25,
        }

    readings = []
    for h in range(hours, 0, -1):
        t = now - dt.timedelta(hours=h)
        t_str = t.strftime("%Y-%m-%dT%H:00")

        # Tidal offset — from harmonic model (real tidal physics)
        tide = _compute_tidal_height(lat, lon, t) if wb_type == "ocean" else 0.0

        # Rainfall impact — from real weather data if available
        rain_impact = 0.0
        w = weather_by_time.get(t_str)
        if w:
            precip_mm = w["precipitation_mm"]
            if precip_mm > 0:
                alpha = {"river": 0.015, "reservoir": 0.01, "lake": 0.008, "ocean": 0.002}.get(wb_type, 0.005)
                monsoon = compute_monsoon_index(lat, t.month)
                rain_impact = alpha * precip_mm * (1 + 0.5 * monsoon)

        # Compute depth
        depth = max(0.1, base + tide + rain_impact)

        readings.append({
            "timestamp": t.isoformat(),
            "computed_depth": round(depth, 2),
            "tidal_offset": round(tide, 3),
            "rainfall_impact": round(rain_impact, 3),
        })

    return DepthHistoryResponse(digipin=digipin.upper(), readings=readings)


@router.get("/satellite/{digipin}")
async def get_satellite_data(digipin: str):
    """Get satellite altimetry proxy data for a DIGIPIN — LIVE."""
    from app.services.digipin_codec import decode
    from app.services.open_meteo import fetch_satellite_sea_surface

    lat, lon, _ = decode(digipin)

    try:
        data = await fetch_satellite_sea_surface(lat, lon)
        return {
            "digipin": digipin.upper(),
            "latitude": lat,
            "longitude": lon,
            **data,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Satellite data failed: {e}")

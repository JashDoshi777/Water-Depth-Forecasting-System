"""ML endpoints: model report, static depth, 6–48 h forecast, flood-risk probability."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.ml import runtime
from app.services.bathymetry import classify_water_body
from app.services.digipin_codec import digipin_for_request

router = APIRouter(prefix="/ml", tags=["ML"])


class PointRequest(BaseModel):
    digipin: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class ForecastRequest(PointRequest):
    timestamp: str | None = Field(default=None, description="ISO-8601 origin time, e.g. 2026-11-12T14:30 (UTC if no offset). Default: now.")
    hours_ahead: int = Field(default=48, ge=1, le=48)


def _resolve(req: PointRequest):
    try:
        return digipin_for_request(req.digipin, req.latitude, req.longitude)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


def _need_models():
    if not runtime.available():
        raise HTTPException(status_code=503, detail="ML models not trained yet — run `python -m app.ml.train` in backend/")


def _parse_ts(ts: str | None):
    if not ts:
        return None
    try:
        d = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(status_code=422, detail="timestamp must be ISO-8601, e.g. 2026-11-12T14:30")
    return d if d.tzinfo else d.replace(tzinfo=dt.timezone.utc)


@router.get("/overview")
async def overview():
    m = runtime.metrics()
    if not m:
        raise HTTPException(status_code=503, detail="metrics unavailable — train the models first")
    return {"metrics": m, "runtime": runtime.benchmark() if runtime.available() else None}


@router.post("/static-depth")
async def static_depth(req: PointRequest):
    _need_models()
    pin, lat, lon = _resolve(req)
    out = runtime.predict_static(lat, lon)
    return {"digipin": pin, "latitude": lat, "longitude": lon, **out}


async def run_forecast(req: ForecastRequest):
    _need_models()
    pin, lat, lon = _resolve(req)
    wb = classify_water_body(lat, lon)
    try:
        res = await runtime.forecast(lat, lon, wb, _parse_ts(req.timestamp), req.hours_ahead)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream data unavailable: {e}")
    return {"digipin": pin, "latitude": lat, "longitude": lon, "water_body_type": wb, **res}


@router.post("/forecast")
async def forecast(req: ForecastRequest):
    """Physics-guided ML forecast (depth, P10–P90 band) for the next 1–48 hours."""
    return await run_forecast(req)


@router.post("/flood")
async def flood(req: PointRequest):
    """Flood-warning probability with ensemble uncertainty."""
    _need_models()
    pin, lat, lon = _resolve(req)
    wb = classify_water_body(lat, lon)
    try:
        res = await runtime.flood_risk(lat, lon, wb)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upstream data unavailable: {e}")
    return {"digipin": pin, "latitude": lat, "longitude": lon, "water_body_type": wb, **res}

"""ML endpoints: model report, static depth, 6–48 h forecast, flood-risk probability."""
from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException, Query
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


# ───────────── Active learning: where to survey next ─────────────
_survey_cache: dict = {}


def _survey_cells() -> dict:
    if not _survey_cache:
        import json, os
        p = os.path.join(os.path.dirname(__file__), "..", "data", "survey_priority.json")
        if not os.path.exists(p):
            raise HTTPException(status_code=503, detail="survey map not built yet — run `python -m app.ml.survey` in backend/")
        _survey_cache.update(json.load(open(p)))
    return _survey_cache


@router.get("/survey-priority")
async def survey_priority(n: int = Query(200, ge=1, le=2000), bbox: str | None = Query(None, description="minLon,minLat,maxLon,maxLat")):
    """GeoJSON FeatureCollection of the least-certain 0.25° ocean cells (bootstrap-ensemble std of the static-depth model), sorted by uncertainty desc."""
    S = _survey_cells()
    cells = S["cells"]
    if bbox:
        try:
            x0, y0, x1, y1 = [float(v) for v in bbox.split(",")]
        except ValueError:
            raise HTTPException(status_code=422, detail="bbox must be minLon,minLat,maxLon,maxLat")
        cells = [c for c in cells if x0 <= c["lon"] <= x1 and y0 <= c["lat"] <= y1]
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [c["lon"], c["lat"]]},
              "properties": {"uncertainty_m": c["uncertainty_m"], "predicted_depth_m": c["predicted_depth_m"], "rank": i + 1,
                             "relative_uncertainty_pct": round(100 * c["uncertainty_m"] / max(c["predicted_depth_m"], 1.0), 1)}}
             for i, c in enumerate(cells[:n])]
    return {"type": "FeatureCollection", "features": feats,
            "metadata": {"resolution_deg": S["resolution_deg"], "n_members": S["n_members"], "n_cells_total": len(S["cells"]), "n_returned": len(feats),
                         "generated_at": S["generated_at"], "heldout_mae_m": S["heldout_mae_m"], "corr_uncertainty_vs_abs_error": S["corr_uncertainty_vs_abs_error"],
                         "note": "uncertainty_m = standard deviation across 8 bootstrap XGBoost models trained on a sparse 10% sample of ETOPO ocean cells: model disagreement, not true error. "
                                 "It is in absolute metres, so it is largest over deep ocean; relative_uncertainty_pct normalises by depth."}}

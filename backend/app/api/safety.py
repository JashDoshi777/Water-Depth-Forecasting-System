"""Safety API: rule-based 'is it safe to go out?' advisory."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Query

from app.services import safety as svc
from app.services.digipin_codec import digipin_for_request

router = APIRouter(prefix="/safety", tags=["Safety"])


@router.get("")
async def safety(
    digipin: str | None = Query(None, description="DIGIPIN of the place"),
    latitude: float | None = None,
    longitude: float | None = None,
    activity: Literal["fishing", "boating", "swimming", "shipping"] = "boating",
):
    """Score 0-100 and level (good / caution / avoid) with transparent per-activity thresholds. Advisory only."""
    try:
        pin, lat, lon = digipin_for_request(digipin, latitude, longitude)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        return await svc.assess(lat, lon, pin, activity)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=f"Upstream data unavailable: {e}")


@router.get("/thresholds")
async def thresholds():
    return {"activities": svc.ACTIVITIES, "thresholds": svc.THRESHOLDS, "disclaimer": svc.DISCLAIMER}

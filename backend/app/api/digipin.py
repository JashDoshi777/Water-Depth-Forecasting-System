"""DIGIPIN encode / decode API endpoints."""

from fastapi import APIRouter, HTTPException
from app.schemas import (
    DigiPinDecodeRequest,
    DigiPinDecodeResponse,
    DigiPinEncodeRequest,
    DigiPinEncodeResponse,
)
from app.services.digipin_codec import decode, encode, is_valid

router = APIRouter(prefix="/digipin", tags=["DIGIPIN"])


@router.post("/encode", response_model=DigiPinEncodeResponse)
async def encode_digipin(req: DigiPinEncodeRequest):
    """Encode latitude/longitude to a 10-character DIGIPIN code."""
    try:
        pin = encode(req.latitude, req.longitude)
        _, _, bbox = decode(pin)
        return DigiPinEncodeResponse(
            digipin=pin,
            latitude=req.latitude,
            longitude=req.longitude,
            bbox=bbox,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/decode", response_model=DigiPinDecodeResponse)
async def decode_digipin(req: DigiPinDecodeRequest):
    """Decode a DIGIPIN code to latitude/longitude and bounding box."""
    if not is_valid(req.digipin):
        raise HTTPException(status_code=400, detail="Invalid DIGIPIN code.")
    try:
        lat, lon, bbox = decode(req.digipin)
        return DigiPinDecodeResponse(
            digipin=req.digipin.upper(),
            latitude=lat,
            longitude=lon,
            bbox=bbox,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/validate/{code}")
async def validate_digipin(code: str):
    """Check if a DIGIPIN code is valid."""
    return {"digipin": code.upper(), "valid": is_valid(code)}

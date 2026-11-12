"""Static map reference data (Natural Earth, public domain): state borders, state labels, rivers."""
from __future__ import annotations

import json
import os
from functools import lru_cache

from fastapi import APIRouter, Response

router = APIRouter(prefix="/map", tags=["Map data"])
_DIR = os.path.join(os.path.dirname(__file__), "..", "data")


@lru_cache(maxsize=8)
def _read(name: str) -> bytes:
    return open(os.path.join(_DIR, name), "rb").read()


def _geojson(name: str) -> Response:
    return Response(_read(name), media_type="application/geo+json", headers={"Cache-Control": "public, max-age=86400"})


@router.get("/states")
async def states():
    """Indian state / UT boundaries (Natural Earth admin-1)."""
    return _geojson("india_states.geojson")


@router.get("/state-labels")
async def state_labels():
    return _geojson("india_state_labels.geojson")


@router.get("/rivers")
async def rivers():
    """Real river centre-lines (Natural Earth 1:10m) for the Indian subcontinent."""
    return _geojson("india_rivers.geojson")

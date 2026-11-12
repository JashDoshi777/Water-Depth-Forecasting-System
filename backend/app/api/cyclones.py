"""North Indian Ocean tropical cyclones (NOAA IBTrACS v04r01), IMD intensity scale."""
from __future__ import annotations

import json
import os
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/cyclones", tags=["Cyclones"])
_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "cyclones_ni.json")
_ORDER = ["D", "DD", "CS", "SCS", "VSCS", "ESCS", "SuCS"]
_HDR = {"Cache-Control": "public, max-age=3600"}


@lru_cache(maxsize=1)
def _load() -> dict:
    with open(_FILE, encoding="utf-8") as f:
        return json.load(f)


def _rank(cat):
    return _ORDER.index(cat) if cat in _ORDER else -1


def _data():
    try:
        return _load()
    except Exception as e:  # missing/corrupt dataset
        raise HTTPException(503, f"Cyclone dataset unavailable ({e}); run backend/scripts/build_cyclones.py")


@router.get("/tracks")
async def tracks(year_from: int | None = None, year_to: int | None = None,
                 min_category: str | None = Query(default=None, description="D|DD|CS|SCS|VSCS|ESCS|SuCS")):
    d = _data()
    if min_category and min_category not in _ORDER:
        raise HTTPException(400, f"min_category must be one of {_ORDER}")
    lo = _rank(min_category) if min_category else -1
    feats = []
    for s in d["storms"]:
        if year_from is not None and s["year"] < year_from: continue
        if year_to is not None and s["year"] > year_to: continue
        if lo >= 0 and _rank(s["category"]) < lo: continue
        feats.append({
            "type": "Feature",
            "geometry": {"type": "LineString", "coordinates": [[p["lon"], p["lat"]] for p in s["points"]]},
            "properties": {k: s[k] for k in ("sid", "name", "year", "season", "max_wind_kt",
                                             "min_pressure_hpa", "category", "start", "end")},
        })
    return JSONResponse({"type": "FeatureCollection", "features": feats, "meta": d["meta"], "count": len(feats)},
                        headers=_HDR)


@router.get("/storm/{sid}")
async def storm(sid: str):
    for s in _data()["storms"]:
        if s["sid"] == sid:
            return {**s, "meta": _data()["meta"]}
    raise HTTPException(404, "Storm not found")


@router.get("/summary")
async def summary():
    d = _data()
    cby: dict[str, int] = {}
    for s in d["storms"]:
        cby[str(s["year"])] = cby.get(str(s["year"]), 0) + 1
    ranked = sorted((s for s in d["storms"] if s["max_wind_kt"]), key=lambda s: -s["max_wind_kt"])[:10]
    strongest = [{k: s[k] for k in ("sid", "name", "year", "max_wind_kt", "min_pressure_hpa", "category")}
                 for s in ranked]
    return {"years": sorted(int(y) for y in cby), "count_by_year": dict(sorted(cby.items())),
            "total": len(d["storms"]), "strongest": strongest, "meta": d["meta"]}

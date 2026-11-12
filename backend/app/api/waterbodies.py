"""Real named Indian lakes & reservoirs (OpenStreetMap + Natural Earth; built by scripts/build_waterbodies.py)."""
from __future__ import annotations

import json
import os
from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query, Response

router = APIRouter(prefix="/waterbodies", tags=["Water bodies"])
_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "waterbodies_india.geojson")


@lru_cache(maxsize=1)
def _raw() -> bytes:
    return open(_FILE, "rb").read()


@lru_cache(maxsize=1)
def _data() -> dict:
    return json.loads(_raw())


def _props() -> list[dict]:
    return [f["properties"] for f in _data()["features"]]


def _guard():
    try:
        _data()
    except Exception as e:
        raise HTTPException(503, f"Water-body dataset unavailable ({e}); run backend/scripts/build_waterbodies.py")


@lru_cache(maxsize=4)
def _geojson_bytes(kind: str) -> bytes:
    d = _data()
    feats = d["features"] if kind == "all" else [f for f in d["features"] if f["properties"]["kind"] == kind]
    return json.dumps({"type": "FeatureCollection", "meta": d["meta"], "features": feats},
                      separators=(",", ":"), ensure_ascii=False).encode()


@router.get("/geojson")
async def geojson(kind: str = Query(default="all", pattern="^(all|lake|reservoir)$")):
    _guard()
    return Response(_geojson_bytes(kind), media_type="application/geo+json",
                    headers={"Cache-Control": "public, max-age=86400"})


@router.get("/list")
async def list_bodies(kind: str = "", q: str = "", state: str = "",
                      limit: int = Query(default=50, ge=1, le=1000), offset: int = Query(default=0, ge=0)):
    _guard()
    items = _props()
    if kind: items = [p for p in items if p["kind"] == kind]
    if state: items = [p for p in items if p["state"].lower() == state.strip().lower()]
    if q:
        ql = q.strip().lower()
        items = [p for p in items if ql in p["name"].lower() or ql in p["state"].lower()]
    items = sorted(items, key=lambda p: -(p["area_km2"] or 0))
    return {"items": items[offset:offset + limit], "total": len(items), "limit": limit, "offset": offset}


@router.get("/stats")
async def stats():
    _guard()
    by_kind: dict[str, int] = {}
    by_state: dict[str, dict[str, int]] = {}
    for p in _props():
        by_kind[p["kind"]] = by_kind.get(p["kind"], 0) + 1
        s = by_state.setdefault(p["state"], {"lake": 0, "reservoir": 0, "total": 0})
        s[p["kind"]] += 1; s["total"] += 1
    return {"total": len(_props()), "by_kind": by_kind,
            "with_outline": sum(1 for p in _props() if p["has_outline"]),
            "by_state": dict(sorted(by_state.items(), key=lambda kv: -kv[1]["total"])),
            "source": _data()["meta"]["source"], "note": _data()["meta"]["note"]}


@router.get("/{body_id}")
async def get_body(body_id: str):
    _guard()
    for p in _props():
        if p["id"] == body_id:
            return p
    raise HTTPException(404, "Water body not found")

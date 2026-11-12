"""Gridded forecast frames (rain / wave / wind) for the map time-scrubber, from Open-Meteo (no key)."""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/forecast-grid", tags=["Forecast grid"])

LATS = [5.0 + 1.5 * i for i in range(21)]    # 5 .. 35
LONS = [66.0 + 1.5 * i for i in range(21)]   # 66 .. 96
HEADERS = {"User-Agent": "AquaDepth/1.0 (research)"}
TTL = 1800
BATCH = 40
_cache: dict[tuple, tuple[float, dict]] = {}
_lock = asyncio.Lock()
_VARS = {
    "rain": ("https://api.open-meteo.com/v1/forecast", "precipitation", "mm"),
    "wind": ("https://api.open-meteo.com/v1/forecast", "wind_speed_10m", "km/h"),
    "wave": ("https://marine-api.open-meteo.com/v1/marine", "wave_height", "m"),
}


async def _fetch_batch(client: httpx.AsyncClient, url: str, hourly: str, coords, hours: int):
    params = {"latitude": ",".join(str(c[0]) for c in coords), "longitude": ",".join(str(c[1]) for c in coords),
              "hourly": hourly, "forecast_hours": hours, "timezone": "GMT"}
    if hourly == "wind_speed_10m":
        params["wind_speed_unit"] = "kmh"
    if "marine" in url:
        params["cell_selection"] = "sea"
    last = None
    for attempt in range(4):
        try:
            r = await client.get(url, params=params, headers=HEADERS, timeout=40)
            if r.status_code == 400 and "marine" in url:
                return [None] * len(coords), None  # whole batch is land / no marine data
            if r.status_code in (429, 500, 502, 503, 504):
                last = f"HTTP {r.status_code}"
                await asyncio.sleep(2 * (attempt + 1))
                continue
            r.raise_for_status()
            j = r.json()
            j = j if isinstance(j, list) else [j]
            return [x.get("hourly", {}).get(hourly) for x in j], (j[0].get("hourly", {}).get("time"))
        except httpx.HTTPError as e:
            last = str(e)
            await asyncio.sleep(2 * (attempt + 1))
    raise RuntimeError(last or "upstream error")


async def _build(var: str, hours: int) -> dict:
    url, hourly, unit = _VARS[var]
    coords = [(la, lo) for la in LATS for lo in LONS]
    series: list = []
    times = None
    async with httpx.AsyncClient() as client:
        for i in range(0, len(coords), BATCH):
            res, t = await _fetch_batch(client, url, hourly, coords[i:i + BATCH], hours)
            series.extend(res)
            times = times or t
            await asyncio.sleep(0.6)
    if not times:
        raise RuntimeError("no time axis returned")
    return {"unit": unit, "times": times, "series": series}


@router.get("")
async def forecast_grid(var: str = Query(default="rain", pattern="^(rain|wave|wind)$"),
                        hours: int = Query(default=48, ge=3, le=120),
                        step: int = Query(default=3, ge=1, le=24)):
    key = (var, hours)
    async with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < TTL:
            raw, gen = hit[1], hit[0]
        else:
            try:
                raw = await _build(var, hours)
                gen = time.time()
                _cache[key] = (gen, raw)
            except Exception as e:
                if hit:  # serve stale
                    raw, gen = hit[1], hit[0]
                else:
                    return JSONResponse({"error": "upstream_unavailable", "detail": f"Open-Meteo request failed: {e}",
                                         "var": var}, status_code=503)
    times, series = raw["times"], raw["series"]
    n = len(times)
    idx = list(range(0, n, step))
    frames = []
    for i in idx:
        fr = []
        for s in series:
            if not s:
                fr.append(None); continue
            if var == "rain":  # sum over the step window ending... starting at this time
                w = [v for v in s[i:i + step] if v is not None]
                fr.append(round(sum(w), 2) if w else None)
            else:
                v = s[i] if i < len(s) else None
                fr.append(None if v is None else round(v, 2))
        frames.append(fr)
    return JSONResponse({
        "var": var, "unit": raw["unit"] + (f" per {step}h" if var == "rain" else ""), "step_hours": step,
        "bounds": {"lat_min": LATS[0], "lat_max": LATS[-1], "lon_min": LONS[0], "lon_max": LONS[-1]},
        "nx": len(LONS), "ny": len(LATS), "lats": LATS, "lons": LONS,
        "times": [t + ":00Z" if len(t) == 16 else t for t in (times[i] for i in idx)],
        "frames": frames,
        "generated_at": datetime.fromtimestamp(gen, timezone.utc).isoformat(timespec="seconds"),
        "source": "Open-Meteo forecast + marine APIs (model output at ~1.5 deg grid points; wave is null over land; "
                  "cached 30 min). Row-major, latitude-major: index = iy*nx + ix.",
    }, headers={"Cache-Control": "public, max-age=900"})

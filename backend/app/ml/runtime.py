"""Model serving: loads the trained boosters once and builds live features (same code path as training)."""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import os
import time
from functools import lru_cache

import numpy as np
import xgboost as xgb
from cachetools import TTLCache

from app.ml import common as C
from app.ml.flood_features import FLOOD_FEATURES, flood_feature_matrix
from app.ml.geo import get_grid, river_distance_km
from app.services.open_meteo import _get_json

ART = os.path.join(os.path.dirname(__file__), "artifacts")
_live: TTLCache = TTLCache(maxsize=500, ttl=600)


class ModelNotReady(RuntimeError):
    pass


@lru_cache(maxsize=1)
def models() -> dict:
    def load(name):
        p = os.path.join(ART, name)
        if not os.path.exists(p):
            raise ModelNotReady(f"{name} missing — run `python -m app.ml.train`")
        b = xgb.Booster(); b.set_param({"nthread": 2}); b.load_model(p); return b
    flood = [load(f"flood_{i}.json") for i in range(5)]
    return {"static": load("static_ocean.json"), "mean": load("forecast_mean.json"), "q10": load("forecast_q10.json"),
            "q90": load("forecast_q90.json"), "flood": flood,
            "flood_meta": json.load(open(os.path.join(ART, "flood_meta.json")))}


def available() -> bool:
    try:
        models(); return True
    except Exception:
        return False


def metrics() -> dict | None:
    p = os.path.join(ART, "metrics.json")
    return json.load(open(p)) if os.path.exists(p) else None


def _predict(booster, X):
    return booster.predict(xgb.DMatrix(X))


# ───────────── Task 1 ─────────────
def predict_static(lat: float, lon: float) -> dict:
    g = get_grid(); m = models()
    shore = g.shore_distance_km(lat, lon); slat, slon = g.nearest_shore(lat, lon)
    from app.services.forecast import _get_seasonal_avg_rain
    seasonal_rain_annual = lambda a, b: float(np.mean([_get_seasonal_avg_rain(a, b, mm) for mm in range(1, 13)]))
    mir, sslope = g.coastal_relief(lat, lon)
    X = np.array([[lat, lon, shore[0], river_distance_km(lat, lon)[0], seasonal_rain_annual(lat, lon), slat[0] - lat, slon[0] - lon, mir[0], sslope[0]]], dtype=np.float32)
    pred = float(np.expm1(_predict(m["static"], X))[0])
    z = float(g.elevation(lat, lon))
    return {"predicted_depth_m": round(pred, 1), "reference_depth_m": round(-z, 1) if z < 0 else None,
            "shore_distance_km": round(float(shore[0]), 1), "is_ocean": z < 0}


# ───────────── live series ─────────────
async def _live_series(lat: float, lon: float, wb: str) -> dict:
    key = f"{round(lat, 2)}:{round(lon, 2)}:{wb}"
    if key in _live:
        return _live[key]
    w = _get_json("https://api.open-meteo.com/v1/forecast", dict(
        latitude=round(lat, 4), longitude=round(lon, 4), hourly="precipitation,temperature_2m",
        past_days=14, forecast_days=3, timezone="GMT"))
    tasks = [w]
    if wb == "ocean":
        tasks.append(_get_json("https://marine-api.open-meteo.com/v1/marine", dict(
            latitude=round(lat, 4), longitude=round(lon, 4), hourly="sea_level_height_msl", past_days=7, forecast_days=3, timezone="GMT")))
    if wb in ("river", "reservoir"):
        tasks.append(_get_json("https://flood-api.open-meteo.com/v1/flood", dict(
            latitude=round(lat, 4), longitude=round(lon, 4), daily="river_discharge", past_days=30, forecast_days=3)))
    res = await asyncio.gather(*tasks, return_exceptions=True)
    if isinstance(res[0], Exception):
        raise res[0]
    wd = res[0]["hourly"]
    t64 = np.array(wd["time"], dtype="datetime64[h]")
    n = len(t64)
    arr = lambda v: np.array([np.nan if x is None else x for x in v], dtype=np.float32)
    out = dict(t64=t64, rain=arr(wd["precipitation"]), temp=arr(wd["temperature_2m"]),
               sea=np.full(n, np.nan, np.float32), disc=np.full(n, np.nan, np.float32), disc_mean=0.0, sources=["ERA5/NWP rainfall"])
    k = 1
    if wb == "ocean":
        if not isinstance(res[k], Exception):
            mt = np.array(res[k]["hourly"]["time"], dtype="datetime64[h]"); mv = arr(res[k]["hourly"]["sea_level_height_msl"])
            pos = np.searchsorted(t64, mt); ok = (pos < n) & (t64[np.minimum(pos, n - 1)] == mt)
            out["sea"][pos[ok]] = mv[ok]; out["sources"].append("Marine sea level")
        k += 1
    if wb in ("river", "reservoir"):
        if not isinstance(res[k], Exception):
            dd = res[k]["daily"]; days = np.array(dd["time"], dtype="datetime64[D]"); v = arr(dd["river_discharge"])
            hours = (t64.astype("datetime64[D]"))
            idx = np.searchsorted(days, hours); idx = np.clip(idx, 0, len(v) - 1)
            out["disc"] = v[idx]; out["disc_mean"] = float(np.nanmean(v)) if not np.isnan(v).all() else 0.0
            out["sources"].append("GloFAS discharge")
    _live[key] = out
    return out


def _origin_index(t64, when: dt.datetime | None):
    now = np.datetime64(dt.datetime.now(dt.timezone.utc).replace(tzinfo=None), "h")
    t0 = np.datetime64((when or dt.datetime.now(dt.timezone.utc)).astimezone(dt.timezone.utc).replace(tzinfo=None), "h")
    if when is None:
        t0 = now
    i0 = int(np.searchsorted(t64, t0))
    return t0, i0


# ───────────── Task 2 ─────────────
async def forecast(lat: float, lon: float, wb: str, when: dt.datetime | None = None, hours: int = 48) -> dict:
    from app.services.bathymetry import estimate_base_depth
    m = models(); g = get_grid()
    s = await _live_series(lat, lon, wb)
    t0, i0 = _origin_index(s["t64"], when)
    hours = int(min(max(hours, 1), 48))
    if i0 < 340 or i0 + hours >= len(s["t64"]) - 1 or s["t64"][min(i0, len(s["t64"]) - 1)] != t0:
        raise ValueError("timestamp outside the available live window (about 14 days back to ~1 day ahead)")
    base = estimate_base_depth(lat, lon, wb)
    depth = C.physics_depth(s["t64"], lat, wb, base, s["rain"], s["sea"], s["disc"], s["disc_mean"], rng=None)
    shore = float(g.shore_distance_km(lat, lon)[0]); slope = float(g.gradient(lat, lon))
    st = C.static_features(lat, lon, base, wb, shore, slope)
    hs = np.arange(1, hours + 1)
    X = C.horizon_features(s["t64"], np.full(hours, i0), hs, lat, s["rain"], s["sea"], s["disc"], s["disc_mean"], depth, st)
    t_start = time.perf_counter()
    mean = _predict(m["mean"], X); q10 = _predict(m["q10"], X); q90 = _predict(m["q90"], X)
    infer_ms = (time.perf_counter() - t_start) * 1000
    d0 = float(depth[i0]); cap = base * 1.5 + 3.0
    pred = np.clip(d0 + mean, 0.1, cap); lo = np.minimum(np.clip(d0 + q10, 0.1, cap), pred); hi = np.maximum(np.clip(d0 + q90, 0.1, cap), pred)
    sea = C.fill_nan(s["sea"]) if wb == "ocean" else np.zeros(len(s["t64"]))
    cum = np.concatenate([[0.0], np.cumsum(np.nan_to_num(s["rain"]))])
    pts = []
    for k, h in enumerate(hs):
        ts = (s["t64"][i0 + h]).astype("datetime64[s]").astype(dt.datetime).replace(tzinfo=dt.timezone.utc)
        rain_c = float(C.ALPHA[wb] * (1 + 0.5 * C.monsoon_table(lat)[ts.month - 1]) * (cum[i0 + h + 1] - cum[max(0, i0 + h - 71)]))
        pts.append({"timestamp": ts.isoformat(), "predicted_depth": round(float(pred[k]), 3), "confidence_low": round(float(lo[k]), 3),
                    "confidence_high": round(float(hi[k]), 3), "tidal_component": round(float(sea[i0 + h]), 3), "rainfall_component": round(rain_c, 4)})
    return {"origin": t0.astype("datetime64[s]").astype(dt.datetime).replace(tzinfo=dt.timezone.utc).isoformat(), "current_depth": round(d0, 3),
            "base_depth": round(base, 2), "forecast": pts, "inference_ms": round(infer_ms, 2), "sources": s["sources"], "model_version": "xgboost-forecast-v1"}


# ───────────── Task 3 ─────────────
async def flood_risk(lat: float, lon: float, wb: str) -> dict:
    from app.services.bathymetry import estimate_base_depth
    m = models(); g = get_grid(); meta = m["flood_meta"]
    s = await _live_series(lat, lon, wb)
    t0, i0 = _origin_index(s["t64"], None)
    i0 = min(i0, len(s["t64"]) - 1)
    base = estimate_base_depth(lat, lon, wb)
    depth = C.physics_depth(s["t64"], lat, wb, base, s["rain"], s["sea"], s["disc"], s["disc_mean"], rng=None)
    cent = np.array(meta["centroids"]); cluster = int(np.argmin(((cent - [lat, lon]) ** 2).sum(1)))
    X = flood_feature_matrix(s["t64"], np.array([i0]), lat, lon, wb, float(g.shore_distance_km(lat, lon)[0]), float(river_distance_km(lat, lon)[0]),
                             cluster, s["rain"], s["temp"], s["sea"], s["disc"], s["disc_mean"], depth)
    p = np.array([_predict(b, X)[0] for b in m["flood"]])
    prob, unc, thr = float(p.mean()), float(p.std()), float(meta["threshold"])
    ratio = prob / thr if thr else 0
    level = "critical" if ratio >= 3 else "high" if ratio >= 2 else "moderate" if ratio >= 1 else "low" if ratio >= 0.4 else "none"
    return {"probability": round(prob, 4), "uncertainty": round(unc, 4), "threshold": round(thr, 3), "warning": prob >= thr, "level": level,
            "interval": [round(max(0.0, prob - 2 * unc), 4), round(min(1.0, prob + 2 * unc), 4)], "rain_24h_mm": round(float(np.nansum(s["rain"][max(0, i0 - 23): i0 + 1])), 1),
            "rain_72h_mm": round(float(np.nansum(s["rain"][max(0, i0 - 71): i0 + 1])), 1), "sources": s["sources"]}


# ───────────── benchmark ─────────────
_bench: dict | None = None


def benchmark() -> dict:
    """Model-only inference latency for a full 48-hour forecast, plus process memory."""
    global _bench
    if _bench:
        return _bench
    import resource
    m = models(); X = np.random.rand(48, len(C.feature_names())).astype(np.float32)
    ts = []
    for _ in range(30):
        t = time.perf_counter(); _predict(m["mean"], X); _predict(m["q10"], X); _predict(m["q90"], X); ts.append((time.perf_counter() - t) * 1000)
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    rss_mb = rss / 1e6 if rss > 1e7 else rss / 1e3            # macOS reports bytes, Linux KB
    size = sum(os.path.getsize(os.path.join(ART, f)) for f in os.listdir(ART) if f.endswith(".json") and f not in ("metrics.json", "meta.json", "flood_meta.json"))
    _bench = {"forecast_48h_p50_ms": round(float(np.percentile(ts, 50)), 2), "forecast_48h_p95_ms": round(float(np.percentile(ts, 95)), 2),
              "process_rss_mb": round(rss_mb, 0), "model_size_mb": round(size / 1e6, 2), "target_ms": 500, "target_memory_gb": 5}
    return _bench

"""Rule-based 'is it safe to go out?' advisory.

Transparent thresholds per activity (see THRESHOLDS). Each factor is scored with
`_penalty`; the overall score is 100 minus the worst factor penalty plus 30 % of the
remaining penalties. Level: avoid if any factor is at/above its 'avoid' threshold
or score < 40; caution if any factor is at/above 'caution' or score < 70; else good.
Advisory only — not an official warning.
"""
from __future__ import annotations

import asyncio
import datetime as dt
from typing import Any

from app.ml import runtime
from app.services import open_meteo as om
from app.services.bathymetry import classify_water_body

ACTIVITIES = {"fishing": "Fishing boat", "boating": "Small boat / kayak", "swimming": "Swimming", "shipping": "Shipping"}

# factor -> (caution, avoid). 'low_is_bad' factors (visibility) trigger when value <= threshold.
THRESHOLDS: dict[str, dict[str, Any]] = {
    "fishing":  {"wave_height_m": (1.5, 2.5), "wind_speed_ms": (10, 15), "wind_gust_ms": (14, 20), "rain_mm_next6h": (15, 40), "visibility_km": (2.0, 0.5), "flood_ratio": (1.5, 3.0)},
    "boating":  {"wave_height_m": (1.0, 2.0), "wind_speed_ms": (8, 14),  "wind_gust_ms": (12, 18), "rain_mm_next6h": (10, 30), "visibility_km": (1.5, 0.5), "flood_ratio": (1.5, 3.0)},
    "swimming": {"wave_height_m": (0.7, 1.5), "wind_speed_ms": (8, 14),  "wind_gust_ms": (12, 18), "rain_mm_next6h": (10, 30), "visibility_km": (1.0, 0.3), "flood_ratio": (1.5, 2.5)},
    "shipping": {"wave_height_m": (3.5, 5.5), "wind_speed_ms": (17, 24), "wind_gust_ms": (22, 30), "rain_mm_next6h": (40, 100), "visibility_km": (1.0, 0.2), "flood_ratio": (2.5, 4.0)},
}
LABELS = {
    "wave_height_m": ("Wave height", "m"), "wind_speed_ms": ("Wind", "m/s"), "wind_gust_ms": ("Gusts", "m/s"),
    "rain_mm_next6h": ("Rain, next 6 h", "mm"), "visibility_km": ("Visibility", "km"), "flood_ratio": ("Flood risk", "% probability"),
}
LOW_IS_BAD = {"visibility_km"}
SOURCES = ["Open-Meteo Marine (ECMWF WAM waves)", "Open-Meteo Weather (wind, rain, visibility)", "AquaDepth ML flood model", "Harmonic tide model"]
DISCLAIMER = "Advisory only — not an official warning. Conditions change quickly and local effects (currents, surf, channels) are not modelled. Always follow IMD, INCOIS and local authority warnings."


def _status(v: float, c: float, a: float, low: bool) -> str:
    if low:
        return "avoid" if v <= a else "caution" if v <= c else "good"
    return "avoid" if v >= a else "caution" if v >= c else "good"


def _penalty(v: float, c: float, a: float, low: bool) -> float:
    if low:  # mirror: treat as 'how far below caution'
        if v > c * 2:
            return 0.0
        if v > c:
            return 25 * (c * 2 - v) / c
        if v > a:
            return 25 + 40 * (c - v) / (c - a)
        return 65 + min(35.0, 35 * (a - v) / max(a, 0.1))
    if v < c:
        return 25 * (v / c) ** 2
    if v < a:
        return 25 + 40 * (v - c) / (a - c)
    return 65 + min(35.0, 35 * (v - a) / a)


def _score(values: dict[str, float], th: dict) -> tuple[int, str, dict[str, str]]:
    pens, sts = [], {}
    for k, v in values.items():
        if v is None or k not in th:
            continue
        c, a = th[k]
        low = k in LOW_IS_BAD
        sts[k] = _status(v, c, a, low)
        pens.append(_penalty(v, c, a, low))
    if not pens:
        return 50, "caution", sts
    pens.sort(reverse=True)
    score = int(round(max(0.0, min(100.0, 100 - (pens[0] + 0.3 * sum(pens[1:]))))))
    level = "avoid" if "avoid" in sts.values() or score < 40 else "caution" if "caution" in sts.values() or score < 70 else "good"
    return score, level, sts


def _hr(h: dict, key: str, i: int):
    arr = h.get(key) or []
    return arr[i] if i < len(arr) and arr[i] is not None else None


def _rain_next(h: dict, i: int, n: int = 6) -> float:
    arr = (h.get("precipitation") or [])[i:i + n]
    return round(sum(x for x in arr if x is not None), 1)


async def _marine(lat, lon):
    try:
        d = await om._get_json(om._BASE_MARINE, {
            "latitude": round(lat, 4), "longitude": round(lon, 4), "timezone": "UTC", "forecast_days": 3,
            "hourly": "wave_height,wave_period,swell_wave_height,wind_wave_height"}, attempts=2)
        h = d.get("hourly") or {}
        return h if any(x is not None for x in (h.get("wave_height") or [])) else None
    except Exception:
        return None


async def _weather(lat, lon):
    return (await om._get_json(om._BASE_WEATHER, {
        "latitude": round(lat, 4), "longitude": round(lon, 4), "timezone": "UTC", "forecast_days": 3, "wind_speed_unit": "ms",
        "hourly": "wind_speed_10m,wind_gusts_10m,precipitation,visibility"}, attempts=2)).get("hourly") or {}


async def _flood(lat, lon, wb):
    try:
        if not runtime.available():
            return None
        return await asyncio.wait_for(runtime.flood_risk(lat, lon, wb), timeout=25)
    except Exception:
        return None


async def assess(lat: float, lon: float, digipin: str, activity: str) -> dict:
    wb = classify_water_body(lat, lon)
    coastal = wb == "ocean"
    marine, wx, fl = await asyncio.gather(_marine(lat, lon) if coastal else asyncio.sleep(0, None), _weather(lat, lon), _flood(lat, lon, wb), return_exceptions=True)
    if isinstance(wx, Exception):
        raise RuntimeError(f"weather data unavailable: {wx}")
    marine = None if isinstance(marine, Exception) else marine
    fl = None if isinstance(fl, Exception) else fl
    th = THRESHOLDS[activity]

    times = wx.get("time") or []
    now = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:00")
    idx = max([i for i, t in enumerate(times) if t <= now] or [0])
    mt = (marine or {}).get("time") or []
    midx = max([i for i, t in enumerate(mt) if t <= now] or [0]) if marine else 0

    vis = _hr(wx, "visibility", idx)
    f = {
        "wave_height_m": _hr(marine, "wave_height", midx) if marine else None,
        "wave_period_s": _hr(marine, "wave_period", midx) if marine else None,
        "swell_height_m": _hr(marine, "swell_wave_height", midx) if marine else None,
        "wind_speed_ms": _hr(wx, "wind_speed_10m", idx),
        "wind_gust_ms": _hr(wx, "wind_gusts_10m", idx),
        "rain_mm_next6h": _rain_next(wx, idx),
        "visibility_km": round(vis / 1000, 1) if vis is not None else None,
        "tide_phase": None, "tide_range": None,
        "flood_probability": fl["probability"] if fl else None,
    }
    if coastal:
        now_dt = dt.datetime.now(dt.timezone.utc)
        series = [om._compute_tidal_height(lat, lon, now_dt + dt.timedelta(hours=k / 2)) for k in range(0, 49)]
        f["tide_phase"] = om.get_tide_phase(series[0])
        f["tide_range"] = round(max(series) - min(series), 2)

    ratio = (fl["probability"] / fl["threshold"]) if fl and fl.get("threshold") else None
    vals = {k: f[k] for k in ("wave_height_m", "wind_speed_ms", "wind_gust_ms", "rain_mm_next6h", "visibility_km")}
    vals["flood_ratio"] = ratio
    score, level, sts = _score(vals, th)

    reasons = []
    for k in ("wave_height_m", "wind_speed_ms", "wind_gust_ms", "rain_mm_next6h", "visibility_km", "flood_ratio"):
        label, unit = LABELS[k]
        v = vals[k]
        if v is None:
            if k == "wave_height_m":
                reasons.append({"factor": label, "value": None, "unit": unit, "status": "info",
                                "text": "Waves are not modelled for inland waters." if not coastal else "Wave data is unavailable right now, so sea state is not included in the score."})
            continue
        c, a = th[k]
        st = sts[k]
        shown = round(f["flood_probability"] * 100) if k == "flood_ratio" else v
        low = k in LOW_IS_BAD
        if k == "flood_ratio":
            text = f"{'Elevated' if st != 'good' else 'Normal'} flood probability ({shown} %); caution at {c:g}x and avoid at {a:g}x the model's warning threshold."
        elif low:
            text = f"Caution at or below {c:g} km, avoid at or below {a:g} km."
        else:
            text = f"Caution at {c:g} {unit}, avoid at {a:g} {unit}." if st == "good" else (f"Above the caution level of {c:g} {unit}." if st == "caution" else f"Above the avoid level of {a:g} {unit}.")
        reasons.append({"factor": label, "value": shown, "unit": unit, "status": st, "text": text})
    if fl is None:
        reasons.append({"factor": "Flood risk", "value": None, "unit": "", "status": "info", "text": "Flood model unavailable right now; not included in the score."})
    if coastal and f["tide_phase"]:
        reasons.append({"factor": "Tide", "value": f["tide_phase"], "unit": "", "status": "info", "text": f"Tide is {f['tide_phase']}; expected range about {f['tide_range']} m over the next 24 h (harmonic model, informational only)."})
    reasons.sort(key=lambda r: {"avoid": 0, "caution": 1, "good": 2, "info": 3}[r["status"]])

    # 24 h outlook, 3-hourly
    outlook = []
    for step in range(0, 24, 3):
        i = idx + step
        if i >= len(times):
            break
        j = midx + step
        v = {
            "wave_height_m": _hr(marine, "wave_height", j) if marine else None,
            "wind_speed_ms": _hr(wx, "wind_speed_10m", i), "wind_gust_ms": _hr(wx, "wind_gusts_10m", i),
            "rain_mm_next6h": _rain_next(wx, i),
            "visibility_km": (lambda x: round(x / 1000, 1) if x is not None else None)(_hr(wx, "visibility", i)),
            "flood_ratio": ratio,
        }
        s, lv, _ = _score(v, th)
        outlook.append({"time": times[i] + ":00Z" if len(times[i]) == 16 else times[i], "score": s, "level": lv})

    worst = next((r for r in reasons if r["status"] in ("avoid", "caution")), None)
    headline = {
        "good": f"Conditions look favourable for this activity ({ACTIVITIES[activity].lower()}).",
        "caution": f"Take care: {worst['factor'].lower()} is a concern." if worst else "Take care: conditions are marginal.",
        "avoid": f"Not recommended: {worst['factor'].lower()} is beyond safe limits." if worst else "Not recommended right now.",
    }[level]
    srcs = list(SOURCES)
    if fl and fl.get("sources"):
        srcs.extend(s for s in fl["sources"] if s not in srcs)
    return {
        "digipin": digipin, "latitude": lat, "longitude": lon, "water_body_type": wb, "activity": activity, "activity_label": ACTIVITIES[activity],
        "score": score, "level": level, "headline": headline, "reasons": reasons, "factors": f, "outlook": outlook,
        "thresholds": {k: {"caution": v[0], "avoid": v[1], "unit": LABELS[k][1], **({"direction": "below"} if k in LOW_IS_BAD else {})} for k, v in th.items()},
        "waves_modelled": bool(marine), "disclaimer": DISCLAIMER, "sources": srcs,
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    }

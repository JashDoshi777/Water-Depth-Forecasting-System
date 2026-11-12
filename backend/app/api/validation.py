"""Validation API: real tide-gauge (UHSLC) comparison, tide-timing hindcast and IBTrACS cyclone case studies.

All heavy results are precomputed by scripts/build_validation.py and served from app/data/validation_*.{json,npz}
(no network at request time).
"""
from __future__ import annotations

import json
import os
from functools import lru_cache

import numpy as np
from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/validation", tags=["Validation"])
D = os.path.join(os.path.dirname(__file__), "..", "data")
T0 = np.datetime64("2023-11-01T00")
CUTOFF = "2026-05-01T00"

PROVENANCE = {
    "observations": "UH Sea Level Center (UHSLC) fast-delta hourly sea level, ERDDAP dataset global_hourly_fast. Real tide-gauge observations; fast-delta data are research-quality-pending, not final.",
    "model_sea_level": "Open-Meteo Marine hourly sea_level_height_msl at the gauge lat/lon (the sea-level driver of AquaDepth's physics + ML). A global wave/ocean model, not an observation.",
    "forecaster": "AquaDepth XGBoost 1-24 h forecaster (forecast_mean.json), run as a hindcast with archived (ERA5 / Open-Meteo) inputs using the training pipeline's own feature code.",
    "cyclones": "NOAA IBTrACS v04r01, North Indian basin, main best-track.",
    "not_used": "No INCOIS, IMD or NIO tide-gauge data (not available without a key / agreement).",
}
CAVEATS = [
    "A tide gauge is a point observation inside a harbour or estuary; the model sea level is a 0.05-0.25 degree grid cell. Part of the disagreement is scale mismatch, not model error.",
    "Only sea level can be validated. AquaDepth's depth labels were physics-simulated (no public depth-gauge network exists), so depth itself is NOT validated against observations.",
    "Mean offset between gauge datum and model mean sea level is removed before computing RMSE; absolute levels are not validated.",
    "Out-of-sample = hindcast origins on/after 2026-05-01 (the production forecaster was trained on data before that date). Stations whose gauge record ends earlier are shown as in-sample and are never mixed into the out-of-sample figure.",
    "The sea-level driver itself is an independent product and was never fitted to these gauges, so its agreement is independent of the training split. Cochin, Visakhapatnam and Port Blair are within ~40 km of training sites, so the forecaster has seen similar (simulated) series there.",
    "Gauge peaks are detected on hourly data with parabolic interpolation; timing is limited by hourly resolution and by the time-stamp convention of the two products (the model leads the gauge by roughly 30 min at most stations; we report this and do not correct for it).",
    "Training used realised rainfall as a stand-in for forecast rainfall; the hindcast does the same, so this is a best-case evaluation of the rainfall inputs.",
    "Surge case studies: 'tide-only expectation' is a harmonic fit, so residuals include tidal-fit error; compare against the calm-weather baseline reported with each event.",
]


@lru_cache(maxsize=1)
def _summary() -> dict:
    p = os.path.join(D, "validation_summary.json")
    if not os.path.exists(p):
        raise HTTPException(status_code=503, detail="Validation results not built yet - run `python scripts/build_validation.py` in backend/")
    return json.load(open(p))


@lru_cache(maxsize=1)
def _events() -> dict:
    p = os.path.join(D, "validation_events.json")
    if not os.path.exists(p):
        raise HTTPException(status_code=503, detail="Validation events not built yet")
    return json.load(open(p))


@lru_cache(maxsize=1)
def _series():
    p = os.path.join(D, "validation_series.npz")
    if not os.path.exists(p):
        raise HTTPException(status_code=503, detail="Validation series not built yet")
    return dict(np.load(p))


def _round(x, d=3):
    return None if x is None or x != x else round(float(x), d)


def _station_card(s: dict) -> dict:
    a, tt = s.get("agreement_all"), s.get("tide_timing")
    return {
        "id": s["id"], "uhslc_id": s["uhslc_id"], "name": s["name"], "country": s["country"], "lat": s["lat"], "lon": s["lon"],
        "first": s["first"], "last": s["last"], "n_valid_hours": s["n_valid_hours"], "coverage_pct": _round(s["coverage_pct"], 1),
        "has_post_cutoff": s["has_post_cutoff"], "near_training_site": s["near_training_site"],
        "record_note": (f"Record ends {s['last'][:10]} (UHSLC fast-delta lag / station outage); no data after that." if s["last"] < "2026-09-01"
                        else f"Record runs to {s['last'][:10]}; UHSLC fast data lag ~1-6 weeks."),
        "agreement": a and {k: _round(v, 3) for k, v in a.items() if k not in ("n_days_range",)},
        "agreement_post_cutoff": s.get("agreement_post_cutoff") and {k: _round(v, 3) for k, v in s["agreement_post_cutoff"].items()},
        "tide_timing": tt,
    }


@router.get("/summary")
async def summary():
    S = _summary()
    return {"generated_at": S["generated_at"], "headline": S["headline"], "n_events": S["n_events"],
            "histogram": S["histogram"], "cutoff": CUTOFF, "provenance": PROVENANCE, "caveats": CAVEATS,
            "labels": {"observed": "Real tide-gauge observation (UHSLC)", "model": "Model output (Open-Meteo Marine sea level, AquaDepth driver)",
                       "out_of_sample": "Hindcast origins on/after 2026-05-01 (after the forecaster's training data ends)",
                       "in_sample": "Overlaps the forecaster's training period"}}


@router.get("/stations")
async def stations():
    S = _summary()
    return {"stations": [_station_card(s) for s in S["stations"].values()]}


@router.get("/station/{station_id}")
async def station(station_id: str, days: int = Query(30, ge=1, le=1000), end: str | None = Query(None, description="ISO hour; default = last gauge observation")):
    S = _summary()
    st = S["stations"].get(station_id)
    if not st:
        raise HTTPException(status_code=404, detail=f"unknown station '{station_id}'")
    A = _series()
    g, m = A[f"{station_id}_g"], A[f"{station_id}_m"]
    n = len(g)
    try:
        e = int((np.datetime64(end[:13] if end else st["last"][:13]) - T0) / np.timedelta64(1, "h"))
    except ValueError:
        raise HTTPException(status_code=422, detail="end must be ISO-8601, e.g. 2026-09-30T23")
    e = min(max(e, 0), n - 1); b = max(0, e - days * 24 + 1)
    idx = np.arange(b, e + 1)
    stride = int(np.ceil(len(idx) / 1500)) or 1
    idx = idx[::stride]
    t = [str(T0 + np.timedelta64(int(i), "h")) for i in idx]
    conv = lambda arr: [None if arr[i] == -32768 else arr[i] / 1000.0 for i in idx]
    return {"station": _station_card(st), "days": days, "stride_hours": stride, "n": len(idx), "cutoff": CUTOFF, "t": t,
            "gauge_m": conv(g), "model_m": conv(m),
            "units": "metres relative to each product's datum; model has the station's mean gauge-model offset applied",
            "labels": {"gauge_m": "Observed (UHSLC tide gauge)", "model_m": "Model output (Open-Meteo Marine sea level + mean offset)"}}


@router.get("/tide-timing")
async def tide_timing():
    S = _summary()
    H = S["histogram"]
    per = [{"id": s["id"], "name": s["name"], **{k: v for k, v in s["tide_timing"].items() if k != "errors_min"}} for s in S["stations"].values() if s.get("tide_timing")]
    h = S["headline"]
    return {"target_min": h["target_min"], "bin_edges_min": H["bin_edges_min"], "counts": H["counts"],
            "out_of_sample": h["timing_out_of_sample"], "in_sample": h["timing_in_sample"], "primary_period": h["timing_primary_period"],
            "target_met": h["target_met"], "stations": per,
            "method": "For each hindcast origin (every 3 h) the forecaster predicts depth for the next 24 h; its high-water times (parabolic-interpolated local maxima) are matched to the real gauge's high-water times (nearest within 3 h; unmatched = missed). 'driver_only' = the raw Open-Meteo sea level without the ML forecaster, for decomposition.",
            "note": "Both the ML forecaster and its raw sea-level driver miss the 15-minute target; the driver alone leads the gauge by ~30 min (signed median)."}


@router.get("/events")
async def events():
    E = _events()
    out = [{k: v for k, v in e.items() if k not in ("track", "t", "gauge", "tide_expected", "gauge_residual", "model_residual")} for e in E["events"]]
    return {"method": E["method"], "events": out, "featured": next((e["id"] for e in E["events"] if e["surge_distinguishable"]), None),
            "note": "All matched storms pre-date 2026-05-01 (in-sample period for the forecaster); no tropical storm passed within 500 km of a gauge with data after that date."}


@router.get("/event/{event_id}")
async def event(event_id: str):
    for e in _events()["events"]:
        if e["id"] == event_id:
            gp, mp = e["gauge_peak_residual_m"], e["model_peak_residual_m"]
            if not e["surge_distinguishable"]:
                v = "No surge stood out from normal tidal-fit noise at this gauge, so this storm neither confirms nor refutes the model."
            elif e["capture_ratio"] is not None and e["capture_ratio"] >= 0.75:
                v = f"The gauge recorded a {gp:.2f} m non-tidal rise; the model sea level captured about {mp:.2f} m ({e['capture_ratio']*100:.0f}%)."
            elif e["capture_ratio"] is not None and e["capture_ratio"] > 0.25:
                v = f"The gauge recorded a {gp:.2f} m non-tidal rise; the model captured only about {mp:.2f} m ({e['capture_ratio']*100:.0f}%), so it under-predicts the surge."
            else:
                v = f"The gauge recorded a {gp:.2f} m non-tidal rise; the model captured almost none of it ({mp:.2f} m)."
            return {**e, "verdict": v,
                    "labels": {"gauge": "Observed (UHSLC tide gauge) minus its mean", "tide_expected": "Harmonic tide-only expectation (fit to gauge, storms excluded)",
                               "gauge_residual": "Observed minus tide-only expectation", "model_residual": "Model sea level minus its own tide-only fit"},
                    "caveat": "Residuals include harmonic-fit error; compare with the calm baselines (95th-percentile 3-day maxima outside storms)."}
    raise HTTPException(status_code=404, detail=f"unknown event '{event_id}'")

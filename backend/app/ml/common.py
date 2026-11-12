"""Shared feature engineering for the three ML tasks (training AND serving use the same code)."""
from __future__ import annotations

import math

import numpy as np

# Tidal constituent periods (hours) + spring/neap beat (M2–S2)
PERIODS = {"M2": 12.4206, "S2": 12.0, "K1": 23.9345, "O1": 25.8193}
SPRING_NEAP_H = 1.0 / (1.0 / 12.0 - 1.0 / 12.4206)          # ≈ 354 h (14.8 days)
EPOCH_H = 0.0
TYPE_CODE = {"ocean": 0, "river": 1, "lake": 2, "reservoir": 3}
SEA_LAGS = [0, 1, 2, 3, 6, 12, 13, 24, 25, 36, 37, 48]
HORIZONS = [1, 2, 3, 6, 9, 12, 18, 24, 36, 48]

ALPHA = {"river": 0.015, "reservoir": 0.010, "lake": 0.008, "ocean": 0.002}
BETA = {"river": 0.5, "reservoir": 0.3, "lake": 0.3, "ocean": 0.0}
EVAP = {1: .02, 2: .03, 3: .05, 4: .07, 5: .08, 6: .04, 7: .02, 8: .01, 9: .02, 10: .03, 11: .02, 12: .02}


def hours_since_2000(t64: np.ndarray) -> np.ndarray:
    """datetime64[h] → hours since 2000-01-01T12 (UTC)."""
    return (t64.astype("datetime64[h]") - np.datetime64("2000-01-01T12")).astype(np.float64)


def tide_phase(hours: np.ndarray) -> np.ndarray:
    """sin/cos of the four principal constituents + spring-neap phase → (n, 10)."""
    cols = []
    for p in list(PERIODS.values()) + [SPRING_NEAP_H]:
        a = 2 * np.pi * hours / p
        cols += [np.sin(a), np.cos(a)]
    return np.stack(cols, axis=1)


def monsoon_table(lat: float) -> np.ndarray:
    from app.services.open_meteo import compute_monsoon_index
    return np.array([compute_monsoon_index(lat, m) for m in range(1, 13)])


def months_of(t64: np.ndarray) -> np.ndarray:
    return t64.astype("datetime64[M]").astype(int) % 12 + 1


def rolling_sum(x: np.ndarray, w: int) -> np.ndarray:
    c = np.concatenate([[0.0], np.cumsum(np.nan_to_num(x))])
    out = np.empty_like(x, dtype=np.float64)
    idx = np.arange(len(x))
    lo = np.maximum(0, idx - w + 1)
    out[:] = c[idx + 1] - c[lo]
    return out


def fill_nan(x: np.ndarray) -> np.ndarray:
    x = x.astype(np.float64).copy()
    bad = np.isnan(x)
    if bad.all():
        return np.zeros_like(x)
    if bad.any():
        x[bad] = np.interp(np.flatnonzero(bad), np.flatnonzero(~bad), x[~bad])
    return x


def physics_depth(t64, lat, wb, base, rain, sea, disc, disc_mean, rng=None, noise=0.02):
    """Hydrodynamic depth model  Depth = Base + α·Rain72 + β·ΔDischarge + Tide − δ·Evap  (+ sensor noise)."""
    n = len(t64)
    mon = monsoon_table(lat)[months_of(t64) - 1]
    rain72 = rolling_sum(rain, 72)
    d = base + ALPHA[wb] * (1 + 0.5 * mon) * rain72
    if wb == "ocean":
        d = d + fill_nan(sea)
    if BETA[wb] and disc_mean and disc_mean > 0:
        anomaly = np.clip((fill_nan(disc) - disc_mean) / disc_mean, -1.0, 6.0)
        d = d + BETA[wb] * anomaly
    ev = np.array([EVAP[m] for m in range(1, 13)])[months_of(t64) - 1] * max(0.5, 1 + (20 - lat) / 40)
    d = d - ev
    if rng is not None and noise:
        e = rng.normal(0, noise, n); out = np.empty(n); out[0] = e[0]
        for i in range(1, n):
            out[i] = 0.9 * out[i - 1] + e[i]
        d = d + out
    return np.maximum(0.1, d)


FEATURE_NAMES: list[str] = []


def static_features(lat, lon, base, wb, shore_km, slope) -> list[float]:
    return [lat, lon, base, TYPE_CODE[wb], shore_km, slope]


def horizon_features(t64, i0: np.ndarray, h: np.ndarray, lat, rain, sea, disc, disc_mean, depth_now, static):
    """Vectorised feature matrix for forecast origins i0 (indices into the hourly series) and horizons h."""
    n = len(i0)
    th = t64[i0 + h]
    hrs = hours_since_2000(th)
    mon = monsoon_table(lat)[months_of(th) - 1]
    mth = months_of(th)
    sea_f = fill_nan(sea)
    r1 = rolling_sum(rain, 1); r6 = rolling_sum(rain, 6); r24 = rolling_sum(rain, 24)
    r72 = rolling_sum(rain, 72); r168 = rolling_sum(rain, 168)
    cum = np.concatenate([[0.0], np.cumsum(np.nan_to_num(rain))])
    r_fut = cum[i0 + h + 1] - cum[i0 + 1]
    dm = disc_mean if disc_mean and disc_mean > 0 else 1.0
    dfill = fill_nan(disc)
    danom = np.clip((dfill - dm) / dm, -1, 6)
    cols = [np.full(n, v, dtype=np.float64) for v in static]
    cols += [h.astype(float), np.sin(2 * np.pi * mth / 12), np.cos(2 * np.pi * mth / 12),
             np.sin(2 * np.pi * (th.astype("datetime64[h]").astype(int) % 24) / 24),
             np.cos(2 * np.pi * (th.astype("datetime64[h]").astype(int) % 24) / 24), mon]
    cols += list(tide_phase(hrs).T)
    cols += [sea_f[i0 - l] for l in SEA_LAGS]
    cols += [depth_now[i0] - static[2], r1[i0], r6[i0], r24[i0], r72[i0], r168[i0], r_fut, danom[i0], danom[i0 - 24]]
    return np.stack(cols, axis=1).astype(np.float32)


def feature_names() -> list[str]:
    names = ["lat", "lon", "base_depth", "type", "shore_km", "slope",
             "horizon_h", "month_sin", "month_cos", "hour_sin", "hour_cos", "monsoon_idx"]
    for k in list(PERIODS) + ["springneap"]:
        names += [f"tide_{k}_sin", f"tide_{k}_cos"]
    names += [f"sea_lag{l}" for l in SEA_LAGS]
    names += ["depth_anom_now", "rain_1h", "rain_6h", "rain_24h", "rain_72h", "rain_7d", "rain_future_h", "disc_anom_now", "disc_anom_24h"]
    return names

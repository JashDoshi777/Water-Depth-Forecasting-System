"""Features for Task 3 (extreme-event / flood-risk). Shared by training and serving."""
from __future__ import annotations

import numpy as np

from app.ml.common import TYPE_CODE, fill_nan, hours_since_2000, months_of, monsoon_table, rolling_sum, tide_phase

FLOOD_FEATURES = [
    "rain_6h", "rain_24h", "rain_72h", "rain_7d", "rain_14d", "rain_dev_72h", "rain_dev_7d",
    "depth_trend_6h", "depth_trend_24h", "disc_anom", "disc_trend_24h", "sea_level", "tide_M2_sin", "tide_M2_cos",
    "monsoon_idx", "temp", "lat", "lon", "shore_km", "river_km", "type", "cluster",
]
HEAVY_RAIN_MM = 64.5      # IMD "heavy rainfall" threshold, mm / 24 h


def seasonal_rain_72h(lat, lon, months):
    from app.services.forecast import _get_seasonal_avg_rain
    tbl = np.array([_get_seasonal_avg_rain(lat, lon, m) for m in range(1, 13)])
    return tbl[np.asarray(months) - 1]


def flood_feature_matrix(t64, idx, lat, lon, wb, shore_km, river_km, cluster, rain, temp, sea, disc, disc_mean, depth):
    r6, r24, r72 = rolling_sum(rain, 6), rolling_sum(rain, 24), rolling_sum(rain, 72)
    r7, r14 = rolling_sum(rain, 168), rolling_sum(rain, 336)
    mon = months_of(t64)
    clim72 = seasonal_rain_72h(lat, lon, mon)
    dev72 = (r72 - clim72) / np.maximum(clim72, 10.0)
    dev7 = (r7 - clim72 * 7 / 3) / np.maximum(clim72 * 7 / 3, 20.0)
    dm = disc_mean if disc_mean and disc_mean > 0 else 1.0
    danom = np.clip((fill_nan(disc) - dm) / dm, -1, 6)
    dfill = fill_nan(disc)
    dtrend = np.clip((dfill - np.roll(dfill, 24)) / dm, -3, 3)
    sea_f = fill_nan(sea)
    ph = tide_phase(hours_since_2000(t64))
    tf = np.nan_to_num(temp, nan=25.0)
    cols = [r6, r24, r72, r7, r14, dev72, dev7,
            depth - np.roll(depth, 6), depth - np.roll(depth, 24), danom, dtrend, sea_f, ph[:, 0], ph[:, 1],
            monsoon_table(lat)[mon - 1], tf]
    X = np.stack(cols, axis=1)[idx]
    n = len(idx)
    stat = np.tile([lat, lon, shore_km, river_km, TYPE_CODE[wb], cluster], (n, 1))
    return np.concatenate([X, stat], axis=1).astype(np.float32)

"""Active learning — 'where to survey next'.   python -m app.ml.survey

Bootstrap ensemble of small XGBoost boosters for the static-depth task. The data pipeline (ocean cells of the real NOAA ETOPO grid in the
India region, the same 9 geo features as app.ml.train.task1, log-depth target, sparse 10 % training sample) is re-implemented here as
`ocean_dataset()` so train.py stays untouched. Each member is fit on a bootstrap resample of the sparse sample; the ensemble standard
deviation (metres) at every ocean cell is the epistemic-uncertainty map. It measures the models' DISAGREEMENT on sparse data,
not the true error. Output: artifacts/static_ens_{i}.json + app/data/survey_priority.json (0.25° blocks).
"""
from __future__ import annotations

import json, os, time
import numpy as np
import xgboost as xgb

from app.ml.geo import get_grid, river_distance_km

ART = os.path.join(os.path.dirname(__file__), "artifacts")
DATA = os.path.join(os.path.dirname(__file__), "..", "data")
CACHE = os.path.join(os.path.dirname(__file__), "..", "..", "data_cache")
N_MEMBERS = 8
REGION = dict(lat=(5, 25), lon=(66, 95))
PARAMS = dict(n_estimators=140, max_depth=6, learning_rate=0.09, subsample=0.8, colsample_bytree=0.9, tree_method="hist", n_jobs=-1)


def ocean_dataset():
    """Same feature pipeline as train.task1 → (X, depth_m, lat, lon) for every ocean cell (ETOPO < -1 m) in the India region."""
    p = os.path.join(CACHE, "survey_features.npz")
    if os.path.exists(p):
        d = np.load(p); return d["X"], d["depth"], d["la"], d["lo"]
    from app.ml.train import seasonal_rain_annual
    g = get_grid()
    LA, LO = np.meshgrid(g.lats, g.lons, indexing="ij")
    m = (g.z < -1) & (LA >= REGION["lat"][0]) & (LA <= REGION["lat"][1]) & (LO >= REGION["lon"][0]) & (LO <= REGION["lon"][1])
    la, lo, depth = LA[m], LO[m], -g.z[m]
    shore = g.shore_distance_km(la, lo); slat, slon = g.nearest_shore(la, lo)
    riv = river_distance_km(la, lo); mir, sslope = g.coastal_relief(la, lo)
    rain = np.array([seasonal_rain_annual(a, b) for a, b in zip(la[::50], lo[::50])])
    rain_i = np.interp(np.arange(len(la)), np.arange(0, len(la), 50)[: len(rain)], rain)
    X = np.column_stack([la, lo, shore, riv, rain_i, slat - la, slon - lo, mir, sslope]).astype(np.float32)
    os.makedirs(CACHE, exist_ok=True)
    np.savez_compressed(p, X=X, depth=depth.astype(np.float32), la=la.astype(np.float32), lo=lo.astype(np.float32))
    return X, depth, la, lo


def load_ensemble():
    out = []
    for i in range(N_MEMBERS):
        f = os.path.join(ART, f"static_ens_{i}.json")
        if not os.path.exists(f): return None
        b = xgb.Booster(); b.load_model(f); out.append(b)
    return out


def ensemble_predict(boosters, X):
    P = np.stack([np.expm1(b.predict(xgb.DMatrix(X))) for b in boosters])
    return P.mean(0), P.std(0)


def main():
    t0 = time.time(); rng = np.random.default_rng(11)
    X, depth, la, lo = ocean_dataset(); y = np.log1p(depth)
    sparse = rng.choice(len(X), size=int(0.10 * len(X)), replace=False)          # the 'sparse existing survey'
    for i in range(N_MEMBERS):
        bs = rng.choice(sparse, size=len(sparse), replace=True)
        m = xgb.XGBRegressor(**PARAMS, random_state=i).fit(X[bs], y[bs])
        m.get_booster().save_model(os.path.join(ART, f"static_ens_{i}.json"))
    boosters = load_ensemble()
    mu, sd = ensemble_predict(boosters, X)
    held = np.setdiff1d(np.arange(len(X)), sparse)
    mae = float(np.abs(mu[held] - depth[held]).mean())
    # correlation of ensemble std with true |error| on non-training cells (does disagreement flag where it is wrong?)
    err = np.abs(mu[held] - depth[held]); rho = float(np.corrcoef(sd[held], err)[0, 1])
    # coarsen to 0.25°
    step = 0.25; bi = np.floor((la - REGION["lat"][0]) / step).astype(int); bj = np.floor((lo - REGION["lon"][0]) / step).astype(int)
    key = bi * 1000 + bj; uk, inv = np.unique(key, return_inverse=True)
    cnt = np.bincount(inv)
    cells = []
    for name, v in (("unc", sd), ("pred", mu), ("la", la.astype(float)), ("lo", lo.astype(float)), ("true", depth.astype(float))):
        cells.append(np.bincount(inv, weights=v) / cnt)
    unc, pred, cla, clo, true = cells
    keep = cnt >= 3
    order = np.argsort(-unc[keep]); idx = np.flatnonzero(keep)[order]
    rows = [dict(lat=round(float(cla[i]), 3), lon=round(float(clo[i]), 3), uncertainty_m=round(float(unc[i]), 2), predicted_depth_m=round(float(pred[i]), 1),
                 reference_depth_m=round(float(true[i]), 1)) for i in idx]
    json.dump({"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "resolution_deg": step, "n_members": N_MEMBERS,
               "n_train_per_member": int(len(sparse)), "n_ocean_cells": int(len(X)), "heldout_mae_m": mae, "corr_uncertainty_vs_abs_error": rho,
               "params": {k: v for k, v in PARAMS.items() if k != "n_jobs"}, "cells": rows},
              open(os.path.join(DATA, "survey_priority.json"), "w"), separators=(",", ":"))
    tot = sum(os.path.getsize(os.path.join(ART, f"static_ens_{i}.json")) for i in range(N_MEMBERS)) / 1e6
    print(f"members {N_MEMBERS} size {tot:.1f} MB; cells {len(rows)}; held-out MAE {mae:.1f} m; rho(unc, |err|) {rho:.2f}; {time.time()-t0:.0f}s")
    print(rows[:5])


if __name__ == "__main__":
    main()

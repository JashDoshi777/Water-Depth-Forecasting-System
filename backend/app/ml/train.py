"""Train + evaluate the three ML tasks.   python -m app.ml.train

Task 1  Static depth       XGBoost on REAL NOAA ETOPO bathymetry (sparse samples, spatial block hold-out)
Task 2  Temporal forecast  XGBoost direct multi-horizon (1–48 h) on 3 years of REAL hourly drivers; physics-
                           simulated depth labels (no public depth-gauge network exists); quantile bands
Task 3  Flood risk         Bootstrap XGBoost ensemble (probability + epistemic uncertainty) on real ERA5
                           heavy-rain events (IMD >64.5 mm/24 h), heavily imbalanced
"""
from __future__ import annotations

import glob, json, os, time, zlib
import numpy as np
import xgboost as xgb
from sklearn.cluster import KMeans
from sklearn.metrics import average_precision_score, brier_score_loss, f1_score, precision_score, recall_score

from app.ml import common as C
from app.ml.flood_features import FLOOD_FEATURES, HEAVY_RAIN_MM, flood_feature_matrix
from app.ml.geo import get_grid, river_distance_km

ART = os.path.join(os.path.dirname(__file__), "artifacts")
CACHE = os.path.join(os.path.dirname(__file__), "..", "..", "data_cache")
os.makedirs(ART, exist_ok=True)
rng = np.random.default_rng(7)
METRICS: dict = {"generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
CUT = np.datetime64("2026-05-01T00")                       # temporal test = last ~6 months
UNSEEN = {"goa", "tapi_surat", "kaveri_trichy", "dal_lake", "wayanad", "sundarbans"}


def seasonal_rain_annual(lat, lon):
    from app.services.forecast import _get_seasonal_avg_rain
    return np.mean([_get_seasonal_avg_rain(lat, lon, m) for m in range(1, 13)])


# ───────────────────────── Task 1 ─────────────────────────
def task1():
    from app.services.bathymetry import _shelf_profile_depth
    g = get_grid()
    LA, LO = np.meshgrid(g.lats, g.lons, indexing="ij")
    m = (g.z < -1) & (LA >= 5) & (LA <= 25) & (LO >= 66) & (LO <= 95)
    la, lo, depth = LA[m], LO[m], -g.z[m]
    shore = g.shore_distance_km(la, lo)
    slat, slon = g.nearest_shore(la, lo)
    riv = river_distance_km(la, lo)
    mir, sslope = g.coastal_relief(la, lo)
    rain = np.array([seasonal_rain_annual(a, b) for a, b in zip(la[::50], lo[::50])])
    rain_i = np.interp(np.arange(len(la)), np.arange(0, len(la), 50)[: len(rain)], rain)
    # NOTE: no gradient/slope feature — at an unmapped point it would leak the target neighbourhood.
    X = np.column_stack([la, lo, shore, riv, rain_i, slat - la, slon - lo, mir, sslope]).astype(np.float32)
    y = np.log1p(depth)
    block = (np.floor(la / 2).astype(int) * 100 + np.floor(lo / 2).astype(int))
    ub = np.unique(block); held = set(rng.choice(ub, size=max(1, len(ub) // 4), replace=False))
    in_held = np.isin(block, list(held))
    tr_pool = np.flatnonzero(~in_held)
    tr = rng.choice(tr_pool, size=int(0.10 * len(tr_pool)), replace=False)            # sparse 10 % sample
    rest = np.setdiff1d(tr_pool, tr)
    te_rand = rng.choice(rest, size=min(20000, len(rest)), replace=False)
    te_block = np.flatnonzero(in_held)
    mdl = xgb.XGBRegressor(n_estimators=500, max_depth=8, learning_rate=0.05, subsample=0.8, colsample_bytree=0.9, tree_method="hist", n_jobs=-1)
    mdl.fit(X[tr], y[tr])
    mdl.get_booster().save_model(os.path.join(ART, "static_ocean.json"))

    def ev(idx):
        p = np.expm1(mdl.predict(X[idx])); t = depth[idx]; e = np.abs(p - t); sh = t < 200
        return {"n": int(len(idx)), "mae_m": float(e.mean()), "median_abs_err_m": float(np.median(e)),
                "mae_shelf_lt200m": float(e[sh].mean()) if sh.any() else None, "rmse_m": float(np.sqrt((e ** 2).mean())),
                "rel_err_pct": float(np.median(e / np.maximum(t, 1)) * 100)}
    sub = rng.choice(te_block, size=min(2500, len(te_block)), replace=False)
    base = np.array([_shelf_profile_depth(a, b) for a, b in zip(la[sub], lo[sub])])
    sh = depth[sub] < 200
    METRICS["static_depth"] = {
        "task": "Task 1 — Static depth prediction",
        "algorithm": "XGBoost (gradient-boosted trees) on log-depth",
        "data": "NOAA ETOPO bathymetry, 0.05° grid (real). Sparse 10% sample of ocean cells for training.",
        "features": ["lat", "lon", "geodesic shore distance (pyproj.Geod)", "river distance", "seasonal rain", "direction to shore", "coastal relief (land elevation mirrored across the shoreline)", "shoreline terrain slope"],
        "n_train": int(len(tr)),
        "interpolation_test": ev(te_rand), "spatial_block_test": ev(te_block),
        "baseline_shelf_heuristic_spatial_test": {"mae_m": float(np.abs(base - depth[sub]).mean()), "mae_shelf_lt200m": float(np.abs(base - depth[sub])[sh].mean())},
        "target": "MAE < 0.3 m", "target_met": False,
        "note": "0.3 m is infeasible at 5.5 km grid resolution — would need 10–100 m INCOIS/NHO surveys. Errors are reported honestly in metres.",
    }
    print("task1", json.dumps(METRICS["static_depth"]["spatial_block_test"]))


# ───────────────────────── sites ─────────────────────────
def load_sites():
    from app.services.bathymetry import estimate_base_depth
    g = get_grid(); sites = []
    for f in sorted(glob.glob(os.path.join(CACHE, "*.npz"))):
        d = np.load(f, allow_pickle=True)
        name, lat, lon, wb = str(d["name"]), float(d["lat"]), float(d["lon"]), str(d["type"])
        n = len(d["rain"]); t64 = np.datetime64(str(d["t0"])) + np.arange(n).astype("timedelta64[h]")
        base = estimate_base_depth(lat, lon, wb)
        disc_mean = float(np.nanmean(d["disc"])) if wb in ("river", "reservoir") and not np.isnan(d["disc"]).all() else 0.0
        depth = C.physics_depth(t64, lat, wb, base, d["rain"], d["sea"], d["disc"], disc_mean, rng=np.random.default_rng(zlib.crc32(name.encode())))
        depth_clean = C.physics_depth(t64, lat, wb, base, d["rain"], d["sea"], d["disc"], disc_mean, rng=None)
        sites.append(dict(depth_clean=depth_clean, name=name, lat=lat, lon=lon, wb=wb, t64=t64, base=base, rain=d["rain"], temp=d["temp"], sea=d["sea"], disc=d["disc"],
                          disc_mean=disc_mean, depth=depth, shore=float(g.shore_distance_km(lat, lon)[0]), slope=float(g.gradient(lat, lon)),
                          river=float(river_distance_km(lat, lon)[0])))
    return sites


# ───────────────────────── Task 2 ─────────────────────────
def site_rows(s, origins, hz):
    i0 = np.repeat(origins, len(hz)); h = np.tile(hz, len(origins))
    st = C.static_features(s["lat"], s["lon"], s["base"], s["wb"], s["shore"], s["slope"])
    X = C.horizon_features(s["t64"], i0, h, s["lat"], s["rain"], s["sea"], s["disc"], s["disc_mean"], s["depth"], st)
    y = s["depth"][i0 + h] - s["depth"][i0]
    return X, y, i0, h


def task2(sites):
    tr_X, tr_y, te_sets = [], [], []
    for s in sites:
        n = len(s["t64"]); org = np.arange(168, n - 49, 3)
        is_test_t = s["t64"][org] >= CUT
        if s["name"] in UNSEEN:
            te_sets.append((s, org[is_test_t], "unseen")); continue
        otr = org[~is_test_t]
        # keep a 48 h gap before the cut so no training target overlaps the test period
        otr = otr[s["t64"][otr + 48] < CUT]
        hz = rng.integers(1, 49, size=(len(otr), 5))
        # vectorised: five random horizons (1–48 h) per origin
        i0 = np.repeat(otr, 5); h = hz.reshape(-1)
        st = C.static_features(s["lat"], s["lon"], s["base"], s["wb"], s["shore"], s["slope"])
        tr_X.append(C.horizon_features(s["t64"], i0, h, s["lat"], s["rain"], s["sea"], s["disc"], s["disc_mean"], s["depth"], st))
        tr_y.append(s["depth"][i0 + h] - s["depth"][i0])
        te_sets.append((s, org[is_test_t], "seen"))
    X = np.concatenate(tr_X); y = np.concatenate(tr_y)
    n_train_rows, n_feat = int(len(X)), int(X.shape[1])
    print("task2 train", X.shape)
    kw = dict(n_estimators=450, max_depth=8, learning_rate=0.06, subsample=0.8, colsample_bytree=0.8, min_child_weight=5, tree_method="hist", n_jobs=-1)
    mean = xgb.XGBRegressor(**kw).fit(X, y)
    q10 = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=0.1, **kw).fit(X, y)
    q90 = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=0.9, **kw).fit(X, y)
    for nm, m in (("forecast_mean", mean), ("forecast_q10", q10), ("forecast_q90", q90)):
        m.get_booster().save_model(os.path.join(ART, nm + ".json"))

    res = {"seen": [], "unseen": []}; lo = np.array([], dtype=float)
    cover = {"seen": [0, 0], "unseen": [0, 0]}
    bucket = lambda h: np.where(h <= 6, 0, np.where(h <= 24, 1, 2))
    acc = {k: {"ml": [[], [], []], "persist": [[], [], []], "analog": [[], [], []]} for k in res}
    for s, org, kind in te_sets:
        if len(org) == 0: continue
        sel = org[rng.choice(len(org), size=min(len(org), 250), replace=False)]
        hz = np.arange(1, 49)
        Xs, ys, i0, h = site_rows(s, sel, hz)
        p = mean.predict(Xs); l, u = q10.predict(Xs), q90.predict(Xs)
        cover[kind][0] += int(((ys >= l) & (ys <= u)).sum()); cover[kind][1] += len(ys)
        analog_idx = np.where(h <= 24, i0 + h - 24, i0 + h - 48)
        analog = s["depth"][analog_idx] - s["depth"][i0]
        b = bucket(h)
        for k in range(3):
            mk = b == k
            acc[kind]["ml"][k].append(np.abs(p - ys)[mk]); acc[kind]["persist"][k].append(np.abs(ys)[mk]); acc[kind]["analog"][k].append(np.abs(analog - ys)[mk])
    names = ["1–6 h", "7–24 h", "25–48 h"]
    out = {}
    for kind in ("seen", "unseen"):
        out[kind] = {names[k]: {m: float(np.concatenate(acc[kind][m][k]).mean()) for m in ("ml", "persist", "analog")} for k in range(3)}
        out[kind]["interval_coverage_80pct"] = cover[kind][0] / max(1, cover[kind][1])

    # ── tide-phase timing error (high-tide time, coastal test sites, 24 h windows) ──
    errs = []
    for s, org, kind in te_sets:
        if s["wb"] != "ocean" or len(org) == 0: continue
        for i in rng.choice(org, size=min(len(org), 120), replace=False):
            hs = np.arange(1, 25); st = C.static_features(s["lat"], s["lon"], s["base"], s["wb"], s["shore"], s["slope"])
            X = C.horizon_features(s["t64"], np.full(24, i), hs, s["lat"], s["rain"], s["sea"], s["disc"], s["disc_mean"], s["depth"], st)
            pred = s["depth"][i] + mean.predict(X); true = s["depth_clean"][i + hs]
            def peaks(a):
                k = np.flatnonzero((a[1:-1] > a[:-2]) & (a[1:-1] >= a[2:])) + 1
                out_ = []
                for j in k:
                    d = a[j - 1] - 2 * a[j] + a[j + 1]
                    out_.append(j + (0.5 * (a[j - 1] - a[j + 1]) / d if d != 0 else 0))
                return np.array(out_)
            pt, pp = peaks(true), peaks(pred)
            for x in pt:
                if len(pp): errs.append(np.min(np.abs(pp - x)) * 60)
    errs = np.array(errs) if errs else np.array([np.nan])
    METRICS["forecast"] = {
        "task": "Task 2 — Temporal depth forecasting (1–48 h)",
        "algorithm": "XGBoost direct multi-horizon + quantile (P10/P90) bands",
        "data": f"{len(sites)} sites × ~3 years hourly: ERA5 rainfall, Open-Meteo Marine sea level, GloFAS discharge (real). Depth labels = physics-simulated (no public gauge network).",
        "n_train": n_train_rows, "n_features": n_feat,
        "test_period": "2026-05-01 → 2026-11 (includes the 2026 monsoon)",
        "mae_m_by_horizon": out,
        "tide_phase_error_min": {"median": float(np.nanmedian(errs)), "mean": float(np.nanmean(errs)), "p90": float(np.nanpercentile(errs, 90)), "n_peaks": int(len(errs))},
        "target": "tide phase error < 15 min", "target_met": bool(np.nanmedian(errs) < 15),
        "note": "Training uses realised rainfall as a stand-in for the NWP rainfall forecast (at serving time Open-Meteo's forecast is used).",
    }
    imp = dict(zip(C.feature_names(), mean.feature_importances_.astype(float)))
    METRICS["forecast"]["top_features"] = sorted(imp.items(), key=lambda kv: -kv[1])[:8]
    print("task2", json.dumps(METRICS["forecast"]["mae_m_by_horizon"]["seen"]), "tide err", METRICS["forecast"]["tide_phase_error_min"])


# ───────────────────────── Task 3 ─────────────────────────
def task3(sites):
    cl = KMeans(n_clusters=8, n_init=10, random_state=0).fit(np.array([[s["lat"], s["lon"]] for s in sites]))
    Xs, ys, ts, sid = [], [], [], []
    for k, s in enumerate(sites):
        n = len(s["t64"]); idx = np.arange(336, n - 50, 6)
        cum = np.concatenate([[0.0], np.cumsum(np.nan_to_num(s["rain"]))])
        rain_ev = (cum[idx + 25] - cum[idx + 1]) >= HEAVY_RAIN_MM
        win = np.lib.stride_tricks.sliding_window_view
        trn = s["t64"] < CUT - np.timedelta64(48, "h")
        ev = rain_ev.copy()
        if s["wb"] in ("river", "reservoir") and not np.isnan(s["disc"]).all():
            dd = C.fill_nan(s["disc"]); p95 = np.percentile(dd[trn], 95)
            ev |= (dd[idx] < p95) & (win(dd, 48)[idx + 1].max(axis=1) >= p95)           # flood-stage ONSET within 48 h
        if s["wb"] == "ocean":
            ss = C.fill_nan(s["sea"]); p99 = np.percentile(ss[trn], 99)
            ev |= (ss[idx] < p99) & (win(ss, 24)[idx + 1].max(axis=1) >= p99)           # extreme-surge onset within 24 h
        nxt = ev
        X = flood_feature_matrix(s["t64"], idx, s["lat"], s["lon"], s["wb"], s["shore"], s["river"], int(cl.predict([[s["lat"], s["lon"]]])[0]),
                                 s["rain"], s["temp"], s["sea"], s["disc"], s["disc_mean"], s["depth"])
        Xs.append(X); ys.append(ev.astype(int)); ts.append(s["t64"][idx]); sid += [k] * len(idx)
    X = np.concatenate(Xs); y = np.concatenate(ys); t = np.concatenate(ts); sid = np.array(sid)
    test = t >= CUT; train = (t < CUT - np.timedelta64(48, "h"))
    print("task3 pos rate", y.mean(), "train", train.sum(), "test", test.sum(), "test pos", y[test].sum())
    P = dict(n_estimators=300, max_depth=5, learning_rate=0.05, subsample=0.8, colsample_bytree=0.8, min_child_weight=3, tree_method="hist", n_jobs=-1)
    # out-of-fold on contiguous time blocks → choose the decision threshold (no peeking at test)
    tri = np.flatnonzero(train); order = tri[np.argsort(t[tri])]; folds = np.array_split(order, 4)
    oof = np.zeros(len(y))
    for f in folds:
        rest = np.setdiff1d(order, f)
        oof[f] = xgb.XGBClassifier(**P).fit(X[rest], y[rest]).predict_proba(X[f])[:, 1]
    best, thr = -1, 0.5
    for th in np.linspace(0.05, 0.9, 86):
        pr = (oof[order] >= th).astype(int); yy = y[order]
        if pr.sum() < 20: continue
        p_, r_ = precision_score(yy, pr, zero_division=0), recall_score(yy, pr)
        fb = (1.25 * p_ * r_) / (0.25 * p_ + r_) if p_ + r_ else 0           # F0.5: precision-weighted (warnings)
        if fb > best: best, thr = fb, float(th)
    members = []
    for b in range(5):
        bs = rng.choice(tri, size=len(tri), replace=True)
        m = xgb.XGBClassifier(**P, random_state=b).fit(X[bs], y[bs]); m.get_booster().save_model(os.path.join(ART, f"flood_{b}.json")); members.append(m)
    pm = np.stack([m.predict_proba(X[test])[:, 1] for m in members]); prob, unc = pm.mean(0), pm.std(0)
    pred = (prob >= thr).astype(int); yt = y[test]
    # per-region (unseen-cluster style) check: by site type
    METRICS["flood"] = {
        "task": "Task 3 — Extreme-event (flood) prediction",
        "algorithm": "Bootstrap ensemble of 5 XGBoost classifiers (probability + epistemic uncertainty)",
        "label": f"Flood-warning onset (real data): GloFAS discharge crossing the site p95 within 48 h, OR sea-level surge crossing p99 within 24 h, OR ≥ {HEAVY_RAIN_MM} mm rain in 24 h (IMD heavy-rain class)",
        "n_train": int(train.sum()), "n_test": int(test.sum()), "base_rate_test": float(yt.mean()), "positives_test": int(yt.sum()),
        "threshold": thr,
        "precision": float(precision_score(yt, pred, zero_division=0)), "recall": float(recall_score(yt, pred)),
        "f1": float(f1_score(yt, pred)), "pr_auc": float(average_precision_score(yt, prob)),
        "brier": float(brier_score_loss(yt, prob)),
        "mean_uncertainty": float(unc.mean()), "mean_uncertainty_on_errors": float(unc[pred != yt].mean()) if (pred != yt).any() else None,
        "target": "precision > 0.85", "target_met": bool(precision_score(yt, pred, zero_division=0) > 0.85),
        "note": "Drought detection (F1 > 0.7) and GNN modelling are not implemented; labels derive from real GloFAS/ERA5/marine-model series, not field flood reports.",
    }
    json.dump({"threshold": thr, "centroids": cl.cluster_centers_.tolist(), "features": FLOOD_FEATURES}, open(os.path.join(ART, "flood_meta.json"), "w"))
    print("task3", json.dumps({k: METRICS["flood"][k] for k in ("precision", "recall", "f1", "pr_auc", "threshold", "base_rate_test")}))


def main():
    t0 = time.time()
    task1()
    sites = load_sites(); print("sites", len(sites))
    task2(sites)
    task3(sites)
    json.dump({"feature_names": C.feature_names(), "horizons": C.HORIZONS, "sea_lags": C.SEA_LAGS}, open(os.path.join(ART, "meta.json"), "w"))
    METRICS["train_seconds"] = round(time.time() - t0, 1)
    json.dump(METRICS, open(os.path.join(ART, "metrics.json"), "w"), indent=2)
    print("saved metrics.json")


if __name__ == "__main__":
    main()

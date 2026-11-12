"""Real tide-gauge validation of AquaDepth's sea-level driver and tide-timing.   python scripts/build_validation.py

Observations : UH Sea Level Center (UHSLC) fast-delta hourly sea level, ERDDAP `global_hourly_fast` (free, no key)
Model inputs : Open-Meteo Marine `sea_level_height_msl` + ERA5 archive rain/temp at the gauge lat/lon (same sources as build_dataset.py)
Cyclones     : NOAA IBTrACS v04r01 North Indian basin CSV
Outputs      : backend/data_cache/uhslc/*.csv, backend/data_cache/val_*.npz (raw, git-ignored)
               backend/app/data/validation_summary.json, validation_series.npz, validation_events.json (small, committed)
"""
from __future__ import annotations

import csv, io, json, os, sys, time, urllib.parse, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import numpy as np
import xgboost as xgb

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "..", "data_cache")
UH = os.path.join(CACHE, "uhslc"); os.makedirs(UH, exist_ok=True)
OUTD = os.path.join(HERE, "..", "app", "data")
ART = os.path.join(HERE, "..", "app", "ml", "artifacts")
UA = "AquaDepth-validation/1.0 (research; contact aquadepth@example.org)"
START, END = "2023-11-01", "2026-11-05"
T0 = np.datetime64("2023-11-01T00")
CUT = np.datetime64("2026-05-01T00")
TARGET_MIN = 15.0
STATIONS = [  # uhslc id, slug, label, country
    (174, "cochin", "Cochin", "India"), (157, "visakhapatnam", "Visakhapatnam", "India"),
    (908, "port_blair", "Port Blair", "India"), (153, "minicoy", "Minicoy", "India"),
    (115, "colombo", "Colombo", "Sri Lanka"), (117, "hanimaadhoo", "Hanimaadhoo", "Maldives"),
    (124, "chittagong", "Chittagong", "Bangladesh"), (907, "sittwe", "Sittwe", "Myanmar"),
]
TRAIN_SITES = {"kochi": (9.95, 76.22), "visakhapatnam": (17.68, 83.35), "port_blair": (11.60, 92.70), "chennai": (13.08, 80.32),
               "mumbai": (19.07, 72.80), "kandla": (22.9, 70.1), "tuticorin": (8.8, 78.25), "sundarbans": (21.7, 88.6)}


def http(url, params=None, tries=6):
    q = url + ("?" + (params if isinstance(params, str) else urllib.parse.urlencode(params)) if params else "")
    for i in range(tries):
        try:
            return urllib.request.urlopen(urllib.request.Request(q, headers={"User-Agent": UA}), timeout=180).read()
        except Exception as e:
            print("  retry", i, str(e)[:70], file=sys.stderr); time.sleep(5 * (i + 1))
    raise SystemExit(f"failed {q}")


def fetch_gauge(uid):
    p = os.path.join(UH, f"{uid}.csv")
    if not os.path.exists(p):
        qs = (f"uhslc_id,station_name,latitude,longitude,time,sea_level,quality&uhslc_id={uid}"
              f"&time%3E=2023-10-30T00:00:00Z&orderBy(%22time%22)")
        open(p, "wb").write(http("https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_fast.csv", qs))
    rows = list(csv.reader(open(p)))[2:]
    n = int((np.datetime64("2026-11-06T00") - T0) / np.timedelta64(1, "h"))
    g = np.full(n, np.nan); q = np.zeros(n, dtype=np.int8)
    lat, lon = float(rows[0][2]), float(rows[0][3])
    for r in rows:
        t = np.datetime64(r[4][:13]); i = int((t - T0) / np.timedelta64(1, "h"))
        if 0 <= i < n and r[5] not in ("NaN", ""):
            g[i] = float(r[5]) / 1000.0; q[i] = int(float(r[6])) if r[6] not in ("NaN", "") else 0
    return g, q, lat, lon


def arr(v):
    return np.array([np.nan if x is None else x for x in v], dtype=np.float32)


def fetch_model(slug, lat, lon):
    p = os.path.join(CACHE, f"val_{slug}.npz")
    if os.path.exists(p):
        d = np.load(p); return d["rain"], d["temp"], d["sea"]
    w = json.loads(http("https://archive-api.open-meteo.com/v1/archive", dict(latitude=lat, longitude=lon, hourly="precipitation,temperature_2m", start_date=START, end_date=END, timezone="GMT")))
    m = json.loads(http("https://marine-api.open-meteo.com/v1/marine", dict(latitude=lat, longitude=lon, hourly="sea_level_height_msl", start_date=START, end_date=END, timezone="GMT")))
    rain, temp = arr(w["hourly"]["precipitation"]), arr(w["hourly"]["temperature_2m"])
    n = len(rain); sea = np.full(n, np.nan, dtype=np.float32); s = arr(m["hourly"]["sea_level_height_msl"]); sea[:min(n, len(s))] = s[:n]
    np.savez_compressed(p, rain=rain, temp=temp, sea=sea, t0=w["hourly"]["time"][0])
    time.sleep(1.5)
    return rain, temp, sea


# ───────── harmonic analysis (tide-only expectation) ─────────
PER = [12.4206, 12.0, 12.6583, 11.9672, 23.9345, 25.8193, 24.0659, 26.8684, 6.2103, 6.1033, 6.2692, 4.1402, 4.0925, 6.0,
       12.8718, 12.6260, 12.1916, 12.0164, 11.9836, 12.9054, 23.0985, 22.3061, 28.0063, 8.2804, 8.1771, 3.1051, 354.37, 327.86, 661.31, 4383.0, 8766.0]


def design(h):
    cols = [np.ones_like(h)]
    for p in PER:
        a = 2 * np.pi * h / p; cols += [np.sin(a), np.cos(a)]
    return np.stack(cols, 1)


def harmonic_fit(h, y, mask):
    ok = mask & np.isfinite(y)
    beta, *_ = np.linalg.lstsq(design(h[ok]), y[ok], rcond=None)
    return design(h) @ beta


def smooth(x, w=73):
    """centred moving mean, NaN-aware"""
    v = np.isfinite(x); xv = np.where(v, x, 0.0); k = np.ones(w)
    num = np.convolve(xv, k, "same"); den = np.convolve(v.astype(float), k, "same")
    return np.where(den > w * 0.6, num / np.maximum(den, 1), np.nan)


def peaks(a):
    k = np.flatnonzero((a[1:-1] > a[:-2]) & (a[1:-1] >= a[2:])) + 1
    out = []
    for j in k:
        d = a[j - 1] - 2 * a[j] + a[j + 1]
        out.append(j + (0.5 * (a[j - 1] - a[j + 1]) / d if d != 0 else 0.0))
    return np.array(out)


def hav(lat1, lon1, lat2, lon2):
    p = np.pi / 180; a = np.sin((lat2 - lat1) * p / 2) ** 2 + np.cos(lat1 * p) * np.cos(lat2 * p) * np.sin((lon2 - lon1) * p / 2) ** 2
    return 12742 * np.arcsin(np.sqrt(a))


def stats_pair(g, s):
    ok = np.isfinite(g) & np.isfinite(s)
    if ok.sum() < 200: return None
    off = float(np.mean(g[ok] - s[ok])); e = (s[ok] + off) - g[ok]
    gs, ss = g - smooth(g), s - smooth(s); ok2 = ok & np.isfinite(gs) & np.isfinite(ss)
    # tidal range ratio on full 24 h days
    n = len(g) // 24 * 24; G, S = g[:n].reshape(-1, 24), s[:n].reshape(-1, 24); full = np.isfinite(G).all(1) & np.isfinite(S).all(1)
    rg, rs = np.ptp(G[full], 1), np.ptp(S[full], 1)
    best = (0, -2)
    for lag in range(-3, 4):  # model lag relative to gauge, hours
        a = np.roll(ss, lag); m = ok2 & np.isfinite(a)
        c = np.corrcoef(gs[m], a[m])[0, 1]
        if c > best[1]: best = (lag, c)
    return {"n_hours": int(ok.sum()), "datum_offset_m": off, "rmse_m": float(np.sqrt(np.mean(e ** 2))), "bias_after_offset_m": float(np.mean(e)),
            "corr": float(np.corrcoef(g[ok], s[ok])[0, 1]),
            "tide_band_rmse_m": float(np.sqrt(np.mean((gs[ok2] - ss[ok2]) ** 2))), "tide_band_corr": float(np.corrcoef(gs[ok2], ss[ok2])[0, 1]),
            "gauge_std_m": float(np.std(g[ok])), "tidal_range_ratio": float(np.mean(rs) / np.mean(rg)) if full.sum() > 10 else None,
            "mean_daily_range_gauge_m": float(np.mean(rg)) if full.sum() > 10 else None, "n_days_range": int(full.sum()),
            "best_lag_h": int(best[0]), "best_lag_corr": float(best[1])}


def main():
    from app.ml import common as C
    from app.ml.geo import get_grid
    from app.services.bathymetry import estimate_base_depth
    mean = xgb.Booster(); mean.load_model(os.path.join(ART, "forecast_mean.json"))
    grid = get_grid()
    n = int((np.datetime64("2026-11-06T00") - T0) / np.timedelta64(1, "h"))
    t64 = T0 + np.arange(n).astype("timedelta64[h]")
    hrs = C.hours_since_2000(t64)
    ib = load_ibtracs()
    st_out, series, G, S = {}, {}, {}, {}
    for uid, slug, label, country in STATIONS:
        g, q, glat, glon = fetch_gauge(uid)
        rain, temp, sea = fetch_model(slug, glat, glon)
        m = min(n, len(sea)); sea_a = np.full(n, np.nan); sea_a[:m] = sea[:m]
        rain_a = np.zeros(n); rain_a[:m] = np.nan_to_num(rain[:m]); G[slug], S[slug] = g, sea_a
        ok = np.isfinite(g); first, last = t64[ok][0], t64[ok][-1]
        print(slug, "gauge", first, last, int(ok.sum()), "model nan", int(np.isnan(sea_a).sum()))
        rec = dict(id=slug, uhslc_id=uid, name=label, country=country, lat=glat, lon=glon,
                   first=str(first), last=str(last), n_valid_hours=int(ok.sum()),
                   coverage_pct=float(100 * ok.sum() / ((last - first) / np.timedelta64(1, "h") + 1)),
                   has_post_cutoff=bool(last >= CUT + np.timedelta64(24 * 7, "h")),
                   near_training_site=any(hav(glat, glon, a, b) < 40 for a, b in TRAIN_SITES.values()))
        rec["agreement_all"] = stats_pair(g, sea_a)
        post = t64 >= CUT
        rec["agreement_post_cutoff"] = stats_pair(np.where(post, g, np.nan), sea_a) if rec["has_post_cutoff"] else None
        # ── hindcast tide timing ──
        base = float(estimate_base_depth(glat, glon, "ocean")); shore = float(grid.shore_distance_km(glat, glon)[0]); slope = float(grid.gradient(glat, glon))
        depth = C.physics_depth(t64, glat, "ocean", base, rain_a, sea_a, np.full(n, np.nan), 0.0)
        st = C.static_features(glat, glon, base, "ocean", shore, slope)
        gv = np.isfinite(g)
        org = np.arange(168, n - 49, 3)
        org = org[(t64[org] > first) & (t64[org] + 25 <= last)]
        out_of_sample = t64[org] >= CUT
        period = "out_of_sample" if out_of_sample.sum() >= 20 else "in_sample"
        org = org[out_of_sample] if period == "out_of_sample" else org
        errs, drv_errs, drv_signed, missed, total = [], [], [], 0, 0
        hz = np.arange(1, 25)
        for i in org:
            win = slice(i + 1, i + 25)
            if gv[win].sum() < 22: continue
            gw = C.fill_nan(g[win]) if False else g[win].copy()
            gw = np.interp(np.arange(24), np.flatnonzero(np.isfinite(gw)), gw[np.isfinite(gw)])
            X = C.horizon_features(t64, np.full(24, i), hz, glat, rain_a, sea_a, np.full(n, np.nan), 0.0, depth, st)
            pred = depth[i] + mean.predict(xgb.DMatrix(X))
            drv = sea_a[win]
            if not np.isfinite(drv).all(): continue
            pg, pp, pd_ = peaks(gw), peaks(pred), peaks(drv)
            for x in pg:
                if x < 1 or x > 22: continue          # skip window-edge peaks
                total += 1
                if len(pp) == 0 or np.min(np.abs(pp - x)) > 3: missed += 1
                else: errs.append(np.min(np.abs(pp - x)) * 60)
                if len(pd_) and np.min(np.abs(pd_ - x)) <= 3:
                    j = int(np.argmin(np.abs(pd_ - x))); drv_errs.append(abs(pd_[j] - x) * 60); drv_signed.append((pd_[j] - x) * 60)
        errs, drv_errs = np.array(errs), np.array(drv_errs)
        if len(errs):
            rec["tide_timing"] = {"period": period, "origin_start": str(t64[org][0]), "origin_end": str(t64[org][-1]), "n_origins": int(len(org)), "n_peaks": int(total),
                                  "n_matched": int(len(errs)), "missed_pct": float(100 * missed / max(total, 1)),
                                  "median_min": float(np.median(errs)), "mean_min": float(errs.mean()), "p90_min": float(np.percentile(errs, 90)),
                                  "driver_only_median_min": float(np.median(drv_errs)) if len(drv_errs) else None, "driver_only_signed_median_min": float(np.median(drv_signed)) if len(drv_signed) else None, "errors_min": [round(float(x), 1) for x in errs], "driver_errors_min": [round(float(x), 1) for x in drv_errs]}
        else:
            rec["tide_timing"] = None
        st_out[slug] = rec
        series[slug] = (g, sea_a)
    # ── harmonic tide + events ──
    events = build_events(ib, st_out, t64, hrs, G, S)
    # ── series file ──
    arrs = {}
    for slug, (g, s) in series.items():
        off = st_out[slug]["agreement_all"]["datum_offset_m"] if st_out[slug]["agreement_all"] else 0.0
        arrs[f"{slug}_g"] = np.where(np.isfinite(g), np.round(g * 1000), -32768).astype(np.int16)
        arrs[f"{slug}_m"] = np.where(np.isfinite(s), np.round((s + off) * 1000), -32768).astype(np.int16)
    np.savez_compressed(os.path.join(OUTD, "validation_series.npz"), t0=str(T0), **arrs)
    json.dump(events, open(os.path.join(OUTD, "validation_events.json"), "w"), separators=(",", ":"))
    summary = headline(st_out, events)
    edges = summary["histogram"]["bin_edges_min"]
    for rec in st_out.values():
        tt = rec["tide_timing"]
        if tt: tt["hist_counts"] = [int(x) for x in np.histogram(tt["errors_min"], bins=edges)[0]]
    summary["stations"] = {k: {kk: vv for kk, vv in v.items()} for k, v in st_out.items()}
    for v in summary["stations"].values():
        if v["tide_timing"]: v["tide_timing"] = {kk: vv for kk, vv in v["tide_timing"].items() if kk not in ("errors_min", "driver_errors_min")}
    json.dump(summary, open(os.path.join(OUTD, "validation_summary.json"), "w"), indent=1)
    print(json.dumps(summary["headline"], indent=1))


def headline(st, events):
    L = list(st.values())
    ag = [s["agreement_all"] for s in L if s["agreement_all"]]
    ts = [s for s in L if s["tide_timing"]]
    def pooled(per):
        e = np.concatenate([np.array(s["tide_timing"]["errors_min"]) for s in ts if s["tide_timing"]["period"] == per] or [np.array([])])
        if not len(e): return None
        return {"n_peaks": int(len(e)), "median_min": float(np.median(e)), "mean_min": float(e.mean()), "p90_min": float(np.percentile(e, 90)),
                "driver_only_median_min": float(np.median(np.concatenate([np.array(s["tide_timing"]["driver_errors_min"]) for s in ts if s["tide_timing"]["period"] == per]))),
                "stations": [s["name"] for s in ts if s["tide_timing"]["period"] == per],
                "missed_pct": float(np.mean([s["tide_timing"]["missed_pct"] for s in ts if s["tide_timing"]["period"] == per]))}
    oos, ins = pooled("out_of_sample"), pooled("in_sample")
    edges = list(range(0, 185, 5)); allerr = {p: np.concatenate([np.array(s["tide_timing"]["errors_min"]) for s in ts if s["tide_timing"]["period"] == p] or [np.array([])]) for p in ("out_of_sample", "in_sample")}
    hist = {p: [int(x) for x in np.histogram(v, bins=edges)[0]] for p, v in allerr.items()}
    prim = oos or ins
    return {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "headline": {"n_gauges": len(L), "gauge_names": [s["name"] for s in L],
                     "median_rmse_m": float(np.median([a["rmse_m"] for a in ag])), "median_corr": float(np.median([a["corr"] for a in ag])),
                     "median_tide_band_corr": float(np.nanmedian([a["tide_band_corr"] if a["tide_band_corr"] == a["tide_band_corr"] else np.nan for a in ag])), "median_range_ratio": float(np.median([a["tidal_range_ratio"] for a in ag if a["tidal_range_ratio"]])),
                     "timing_out_of_sample": oos, "timing_in_sample": ins,
                     "timing_primary_period": "out_of_sample" if oos else "in_sample",
                     "timing_median_min": prim["median_min"] if prim else None, "target_min": TARGET_MIN,
                     "target_met": bool(prim and prim["median_min"] < TARGET_MIN)},
        "histogram": {"bin_edges_min": edges, "counts": hist},
        "n_events": len(events["events"]),
    }


# ───────── IBTrACS ─────────
def load_ibtracs():
    """→ {sid: dict(name, t[datetime64 h], lat, lon, wind)} (main track only, since 2023-10-25). Plain csv (pandas datetime parsing segfaults on py3.15)."""
    p = os.path.join(CACHE, "ibtracs_NI.csv")
    if not os.path.exists(p):
        open(p, "wb").write(http("https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/v04r01/access/csv/ibtracs.NI.list.v04r01.csv"))
    out = {}
    f = open(p, newline=""); rd = csv.reader(f); hdr = next(rd); next(rd)
    ix = {k: hdr.index(k) for k in ("SID", "NAME", "ISO_TIME", "LAT", "LON", "USA_WIND", "WMO_WIND", "TRACK_TYPE")}
    def fl(x):
        try: return float(x)
        except ValueError: return float("nan")
    for r in rd:
        if r[ix["ISO_TIME"]] < "2023-10-25" or r[ix["TRACK_TYPE"]] != "main": continue
        w = fl(r[ix["USA_WIND"]]); w = fl(r[ix["WMO_WIND"]]) if np.isnan(w) else w
        d = out.setdefault(r[ix["SID"]], dict(name=r[ix["NAME"]], t=[], lat=[], lon=[], wind=[]))
        d["t"].append(np.datetime64(r[ix["ISO_TIME"]].replace(" ", "T")[:13])); d["lat"].append(fl(r[ix["LAT"]])); d["lon"].append(fl(r[ix["LON"]])); d["wind"].append(w)
    for d in out.values():
        for k in ("lat", "lon", "wind"): d[k] = np.array(d[k])
        d["t"] = np.array(d["t"], dtype="datetime64[h]")
    return out


def build_events(ib, st, t64, hrs, G, S):
    # tide-only expectation per station, fitted on gauge data excluding storm windows
    exp_g, exp_m = {}, {}
    for slug, rec in st.items():
        mask = np.ones(len(t64), bool)
        for s in ib.values():
            d = hav(rec["lat"], rec["lon"], s["lat"], s["lon"])
            if d.min() < 900:
                a = s["t"].min(); b = s["t"].max()
                mask &= ~((t64 >= a - np.timedelta64(72, "h")) & (t64 <= b + np.timedelta64(96, "h")))
        exp_g[slug] = harmonic_fit(hrs, G[slug], mask)
        exp_m[slug] = harmonic_fit(hrs, S[slug], mask)
    calm = {}
    for slug, rec in st.items():
        # baseline: max residual in non-overlapping 72 h blocks, storm windows excluded → how big the tidal-fit "noise" is
        keep = np.ones(len(t64), bool)
        for s in ib.values():
            if hav(rec["lat"], rec["lon"], s["lat"], s["lon"]).min() < 900:
                keep &= ~((t64 >= s["t"].min() - np.timedelta64(72, "h")) & (t64 <= s["t"].max() + np.timedelta64(96, "h")))
        out = {}
        for nm, src, ex in (("gauge", G[slug], exp_g[slug]), ("model", S[slug], exp_m[slug])):
            r = np.where(keep, src - ex, np.nan); m = len(r) // 72 * 72; B = r[:m].reshape(-1, 72)
            good = np.isfinite(B).mean(1) >= 0.6
            mx = np.nanmax(np.where(np.isfinite(B[good]), B[good], -9), 1) if good.any() else np.array([np.nan])
            out[f"{nm}_p50_m"], out[f"{nm}_p95_m"] = float(np.nanpercentile(mx, 50)), float(np.nanpercentile(mx, 95))
        out["gauge_resid_std_m"] = float(np.nanstd(np.where(keep, G[slug] - exp_g[slug], np.nan)))
        calm[slug] = out
    evs = []
    for sid, s in ib.items():
        name = s["name"].title()
        for slug, rec in st.items():
            d = hav(rec["lat"], rec["lon"], s["lat"], s["lon"])
            k = int(np.argmin(d))
            if d[k] > 500: continue
            tc = s["t"][k]
            lo, hi = tc - np.timedelta64(96, "h"), tc + np.timedelta64(96, "h")
            sel = (t64 >= lo) & (t64 <= hi)
            g = G[slug][sel]
            gcore = np.abs((t64[sel] - tc) / np.timedelta64(1, "h")) <= 48
            if np.isfinite(g).mean() < 0.30 or np.isfinite(g[gcore]).sum() < 24 or len(g) < 190: continue
            rg = (G[slug] - exp_g[slug])[sel]; rm = (S[slug] - exp_m[slug])[sel]
            # +-36 h of closest approach for peak statistics
            core = np.abs((t64[sel] - tc) / np.timedelta64(1, "h")) <= 36
            if not np.isfinite(rg[core]).any() or not np.isfinite(rm[core]).any(): continue
            pk_g = float(np.nanmax(rg[core])); pk_m = float(np.nanmax(rm[core]))
            tg = t64[sel][core][int(np.nanargmax(np.where(np.isfinite(rg[core]), rg[core], -9)))]
            e_ok = np.isfinite(rg) & np.isfinite(rm)
            wmax = float(np.nanmax(s["wind"])) if np.isfinite(s["wind"]).any() else None
            if (wmax is None or wmax < 34) and pk_g < calm[slug]["gauge_p95_m"]: continue          # keep tropical storms or visible surges
            evs.append(dict(
                id=f"{sid}-{slug}", storm=name if name != "Unnamed" else f"Unnamed depression {sid[:4]}", sid=sid, station=slug, station_name=rec["name"], station_lat=rec["lat"], station_lon=rec["lon"],
                closest_km=float(d[k]), closest_time=str(tc), max_wind_kt=wmax,
                period="out_of_sample" if tc >= CUT else "in_sample",
                gauge_peak_residual_m=pk_g, model_peak_residual_m=pk_m, capture_ratio=float(pk_m / pk_g) if pk_g > 0.05 else None,
                gauge_peak_time=str(tg), calm_gauge_p95_m=calm[slug]["gauge_p95_m"], calm_model_p95_m=calm[slug]["model_p95_m"],
                surge_distinguishable=bool(pk_g > calm[slug]["gauge_p95_m"]), gauge_residual_rmse_m=float(np.sqrt(np.nanmean(rg[core] ** 2))), model_residual_rmse_vs_gauge_m=float(np.sqrt(np.nanmean(((rg - rm)[core]) ** 2))),
                corr_residuals=float(np.corrcoef(rg[e_ok], rm[e_ok])[0, 1]) if e_ok.sum() > 20 else None,
                track=[dict(t=str(s["t"][j]), lat=float(s["lat"][j]), lon=float(s["lon"][j]), wind_kt=None if not np.isfinite(s["wind"][j]) else float(s["wind"][j])) for j in range(len(s["t"]))],
                t=[str(x)[:13] for x in t64[sel]],
                gauge=[None if not np.isfinite(x) else round(float(x), 3) for x in G[slug][sel] - np.nanmean(exp_g[slug])],
                tide_expected=[round(float(x - np.nanmean(exp_g[slug])), 3) for x in exp_g[slug][sel]],
                gauge_residual=[None if not np.isfinite(x) else round(float(x), 3) for x in rg],
                model_residual=[None if not np.isfinite(x) else round(float(x), 3) for x in rm],
            ))
    evs.sort(key=lambda e: -(e["gauge_peak_residual_m"] or 0))
    return {"method": "Tide-only expectation = least-squares harmonic fit (30 tidal/long-period constituents incl. M2,S2,N2,K2,K1,O1,P1,Q1,M4,M6,Mf,Mm,Sa,Ssa) to each series with ±3 d before / ±4 d after any cyclone within 900 km masked. Residual = observed (or model) minus that fit.",
            "calm_baseline": calm, "events": evs}


if __name__ == "__main__":
    main()

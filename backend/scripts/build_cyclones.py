"""Build app/data/cyclones_ni.json from NOAA IBTrACS v04r01 North Indian basin CSV.

Source: NOAA NCEI IBTrACS (public domain). Wind preference: IMD New Delhi (3-min sustained),
then WMO, then USA (JTWC, 1-min sustained). Points are subsampled to 6-hourly.
Run:  backend/venv/bin/python backend/scripts/build_cyclones.py
"""
import json, os, sys, time
import httpx

URL = ("https://www.ncei.noaa.gov/data/international-best-track-archive-for-climate-stewardship-ibtracs/"
       "v04r01/access/csv/ibtracs.NI.list.v04r01.csv")
ROOT = os.path.join(os.path.dirname(__file__), "..")
CSV = os.path.join(ROOT, "data_cache", "ibtracs_NI.csv")
OUT = os.path.join(ROOT, "app", "data", "cyclones_ni.json")
UA = {"User-Agent": "AquaDepth/1.0 (research)"}


def category(w):
    """IMD scale from max sustained wind (kt)."""
    if w is None: return None
    if w < 17: return "D"
    if w < 28: return "DD"
    if w < 34: return "CS"
    if w < 48: return "SCS"
    if w < 64: return "VSCS"
    if w < 120: return "ESCS"
    return "SuCS"


def download():
    os.makedirs(os.path.dirname(CSV), exist_ok=True)
    if os.path.exists(CSV) and os.path.getsize(CSV) > 1e6:
        return
    for i in range(4):
        try:
            with httpx.stream("GET", URL, headers=UA, timeout=120, follow_redirects=True) as r:
                r.raise_for_status()
                with open(CSV, "wb") as f:
                    for c in r.iter_bytes(): f.write(c)
            return
        except Exception as e:
            print("download retry", e); time.sleep(5 * (i + 1))
    sys.exit("download failed")


def f(v):
    try:
        x = float(v)
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def main():
    download()
    import csv
    from collections import OrderedDict
    by = OrderedDict()
    with open(CSV, newline="", encoding="utf-8") as fh:
        rd = csv.DictReader(fh)
        next(rd)  # units row
        for r in rd:
            t = r["ISO_TIME"]
            if int(t[11:13]) % 6 != 0: continue
            try:
                lat, lon = float(r["LAT"]), float(r["LON"])
            except ValueError:
                continue
            w = next((v for v in (f(r["NEWDELHI_WIND"]), f(r["WMO_WIND"]), f(r["USA_WIND"])) if v), None)
            p = next((v for v in (f(r["NEWDELHI_PRES"]), f(r["WMO_PRES"]), f(r["USA_PRES"])) if v), None)
            w = None if w is None else int(w)
            by.setdefault(r["SID"], {"season": int(r["SEASON"]), "name": r["NAME"], "pts": []})["pts"].append(
                {"time": t[:10] + "T" + t[11:16] + "Z", "lat": round(lat, 2), "lon": round(lon, 2), "wind_kt": w,
                 "pressure_hpa": None if p is None else int(p), "category": category(w)})
    storms = []
    for sid, d in by.items():
        pts = sorted(d["pts"], key=lambda x: x["time"])
        if len(pts) < 2: continue
        winds = [p["wind_kt"] for p in pts if p["wind_kt"] is not None]
        pres = [p["pressure_hpa"] for p in pts if p["pressure_hpa"] is not None]
        mw = max(winds) if winds else None
        name = d["name"]
        storms.append({"sid": sid, "name": "UNNAMED" if name in ("NOT_NAMED", "UNNAMED", "") else name.title(),
                       "season": d["season"], "year": int(pts[0]["time"][:4]),
                       "max_wind_kt": mw, "min_pressure_hpa": min(pres) if pres else None,
                       "category": category(mw), "start": pts[0]["time"], "end": pts[-1]["time"], "points": pts})
    meta = {"source": "NOAA NCEI IBTrACS v04r01 (North Indian basin)", "wind_note":
            "wind_kt prefers IMD (3-min sustained), then WMO, then USA/JTWC (1-min); categories use IMD scale "
            "(D<17, DD 17-27, CS 28-33, SCS 34-47, VSCS 48-63, ESCS 64-119, SuCS>=120 kt). Older storms often lack wind.",
            "built": time.strftime("%Y-%m-%d")}
    json.dump({"meta": meta, "storms": storms}, open(OUT, "w"), separators=(",", ":"))
    print(len(storms), "storms ->", OUT, os.path.getsize(OUT) // 1024, "KB")


if __name__ == "__main__":
    main()

"""Download 3 years of REAL hourly drivers for training sites (Open-Meteo, free, no key).

  precipitation + temperature : ERA5 reanalysis (archive API), hourly
  sea level (tide + surge)    : Open-Meteo Marine, hourly           (coastal sites)
  river discharge             : GloFAS via Open-Meteo Flood, daily  (river/reservoir sites)

Output: backend/data_cache/<site>.npz   (git-ignored; rebuilt by this script)
"""
import json, os, sys, time, urllib.parse, urllib.request
import numpy as np

START, END = "2023-11-01", "2026-11-05"
OUT = os.path.join(os.path.dirname(__file__), "..", "data_cache")
os.makedirs(OUT, exist_ok=True)

SITES = [  # name, lat, lon, type
    # coastal
    ("mumbai", 19.07, 72.80, "ocean"), ("kochi", 9.95, 76.22, "ocean"), ("chennai", 13.08, 80.32, "ocean"),
    ("visakhapatnam", 17.68, 83.35, "ocean"), ("sundarbans", 21.70, 88.60, "ocean"), ("puri", 19.80, 85.90, "ocean"),
    ("mangalore", 12.88, 74.78, "ocean"), ("goa", 15.40, 73.75, "ocean"), ("kandla", 22.90, 70.10, "ocean"),
    ("surat_coast", 21.10, 72.70, "ocean"), ("tuticorin", 8.80, 78.25, "ocean"), ("paradip", 20.25, 86.75, "ocean"),
    ("port_blair", 11.60, 92.70, "ocean"), ("kakinada", 16.95, 82.30, "ocean"),
    # rivers
    ("ganga_varanasi", 25.30, 83.00, "river"), ("brahmaputra_guwahati", 26.20, 91.75, "river"),
    ("godavari_rajahmundry", 17.00, 81.80, "river"), ("krishna_vijayawada", 16.50, 80.60, "river"),
    ("narmada_bharuch", 21.70, 73.00, "river"), ("yamuna_delhi", 28.60, 77.25, "river"),
    ("mahanadi_cuttack", 20.50, 85.90, "river"), ("kaveri_trichy", 10.85, 78.70, "river"),
    ("ganga_patna", 25.60, 85.20, "river"), ("tapi_surat", 21.20, 72.85, "river"),
    # lakes / reservoirs
    ("chilika", 19.70, 85.30, "lake"), ("vembanad", 9.60, 76.40, "lake"), ("dal_lake", 34.10, 74.85, "lake"),
    ("hirakud", 21.50, 83.90, "reservoir"), ("bhakra", 31.40, 76.40, "reservoir"), ("nagarjuna_sagar", 16.57, 79.30, "reservoir"),
    # extreme-rain sites (flood-event task)
    ("cherrapunji", 25.28, 91.72, "river"), ("agumbe", 13.50, 75.09, "river"),
    ("dehradun", 30.30, 78.00, "river"), ("wayanad", 11.70, 76.10, "lake"),
]


def get(url, params, tries=6):
    q = url + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            return json.loads(urllib.request.urlopen(q, timeout=120).read())
        except Exception as e:
            print("  retry", i, str(e)[:60], file=sys.stderr); time.sleep(4 * (i + 1))
    raise SystemExit(f"failed {q}")


def arr(v):
    return np.array([np.nan if x is None else x for x in v], dtype=np.float32)


for name, lat, lon, typ in SITES:
    path = os.path.join(OUT, f"{name}.npz")
    if os.path.exists(path):
        continue
    print("site", name, file=sys.stderr)
    w = get("https://archive-api.open-meteo.com/v1/archive", dict(latitude=lat, longitude=lon, hourly="precipitation,temperature_2m", start_date=START, end_date=END, timezone="GMT"))
    rain, temp, times = arr(w["hourly"]["precipitation"]), arr(w["hourly"]["temperature_2m"]), w["hourly"]["time"]
    n = len(times)
    sea = np.full(n, np.nan, dtype=np.float32)
    if typ == "ocean":
        m = get("https://marine-api.open-meteo.com/v1/marine", dict(latitude=lat, longitude=lon, hourly="sea_level_height_msl", start_date=START, end_date=END, timezone="GMT"))
        s = arr(m["hourly"]["sea_level_height_msl"])
        sea[: min(n, len(s))] = s[:n]
    disc = np.full(n, np.nan, dtype=np.float32)
    if typ in ("river", "reservoir"):
        f = get("https://flood-api.open-meteo.com/v1/flood", dict(latitude=lat, longitude=lon, daily="river_discharge", start_date=START, end_date=END))
        d = arr(f["daily"]["river_discharge"])
        disc = np.repeat(d, 24)[:n] if len(d) * 24 >= n else np.pad(np.repeat(d, 24), (0, n - len(d) * 24), constant_values=np.nan)
    np.savez_compressed(path, name=name, lat=lat, lon=lon, type=typ, t0=times[0], rain=rain, temp=temp, sea=sea, disc=disc)
    time.sleep(1.5)
print("done")

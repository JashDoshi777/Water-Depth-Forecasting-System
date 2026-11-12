"""Download a regional ETOPO 2022-derived (NOAA ERDDAP etopo180) grid and store it as a compact npz.

Real bathymetry (ocean) + topography (land) at 0.05° (~5.5 km) for India and adjacent seas.
Run once:  python scripts/fetch_etopo.py
"""
import csv, io, sys, urllib.request
import numpy as np

import os
LAT0, LAT1, LON0, LON1, STRIDE = (float(os.environ.get("LAT0", 5)), float(os.environ.get("LAT1", 36)), float(os.environ.get("LON0", 66)), float(os.environ.get("LON1", 98)), int(os.environ.get("STRIDE", 3)))  # stride × 1' per cell
OUTFILE = os.environ.get("OUTFILE", "app/data/etopo_india.npz")
BASE = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.csv"

step = STRIDE / 60.0
lats = np.round(np.arange(LAT0, LAT1 + 1e-9, step), 4)
lons = np.round(np.arange(LON0, LON1 + 1e-9, step), 4)
grid = np.full((len(lats), len(lons)), np.nan, dtype=np.float32)

chunk = float(os.environ.get('CHUNK', 1.5))
TILE_DIR = os.path.join('data_cache', 'etopo_tiles_' + os.path.basename(OUTFILE).replace('.npz', ''))
os.makedirs(TILE_DIR, exist_ok=True)
la = LAT0
while la < LAT1:
    lb = min(la + chunk, LAT1)
    url = f"{BASE}?altitude%5B({la}):{STRIDE}:({lb})%5D%5B({LON0}):{STRIDE}:({LON1})%5D"
    tile = os.path.join(TILE_DIR, f"{la:.3f}.csv")
    if os.path.exists(tile):
        raw = open(tile).read()
    else:
        print("fetch", la, lb, file=sys.stderr)
        import time
        for attempt in range(12):
            try:
                raw = urllib.request.urlopen(url, timeout=180).read().decode(); break
            except Exception as e:
                print("  retry", attempt, e, file=sys.stderr); time.sleep(5 * (attempt + 1))
        else:
            raise SystemExit("giving up (re-run to resume; finished tiles are cached)")
        open(tile, "w").write(raw)
    rd = csv.reader(io.StringIO(raw)); next(rd); next(rd)  # header + units
    for r in rd:
        i = int(round((float(r[0]) - LAT0) / step)); j = int(round((float(r[1]) - LON0) / step))
        if 0 <= i < len(lats) and 0 <= j < len(lons):
            grid[i, j] = float(r[2])
    la = lb + step
print("nan cells:", int(np.isnan(grid).sum()), "min/max:", np.nanmin(grid), np.nanmax(grid), file=sys.stderr)
grid = np.nan_to_num(grid, nan=0.0).astype(np.int16)
np.savez_compressed(OUTFILE, lat0=LAT0, lon0=LON0, step=step, z=grid)
print("saved", grid.shape)

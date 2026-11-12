"""Pre-rendered bathymetry overlay (real NOAA ETOPO data) for the map.

A smooth, Mercator-aligned RGBA PNG: water cells shaded by depth, land fully transparent,
soft anti-aliased shoreline, faint isobaths. Rendered once per colour scheme and cached on disk.
"""
from __future__ import annotations

import io
import os

import numpy as np
from fastapi import APIRouter, HTTPException, Response
from scipy.ndimage import gaussian_filter, map_coordinates, zoom

from app.ml.geo import get_grid, get_wide_grid

router = APIRouter(prefix="/bathymetry", tags=["Bathymetry"])
_CACHE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data_cache")
REGIONS = {  # lat_top, lat_bot, lon_left, lon_right, output width
    "india": (36.0, 5.0, 66.0, 98.0, 1600),
    "wide": (48.0, -12.0, 38.0, 130.0, 2000),
}

# depth (m) → colour stops, per scheme. Restrained, no neon.
RAMPS = {
    "light": [(0, (196, 224, 252)), (50, (172, 209, 248)), (200, (146, 191, 240)), (1000, (118, 166, 226)), (3000, (92, 140, 206)), (6000, (96, 140, 204))],
    "dark":  [(0, (22, 62, 96)), (50, (18, 52, 84)), (200, (15, 44, 74)), (1000, (12, 36, 62)), (3000, (9, 28, 50)), (6000, (6, 20, 38))],
}
ISOBATH = {"light": (255, 255, 255, 70), "dark": (120, 170, 220, 34)}
LEVELS = [50, 200, 1000, 2000, 4000]


def _merc(lat):
    return np.log(np.tan(np.pi / 4 + np.radians(lat) / 2))


def _render(scheme: str, region: str = "india") -> bytes:
    from PIL import Image
    LAT_TOP, LAT_BOT, LON_L, LON_R, OUT_W = REGIONS[region]
    g = get_grid() if region == "india" else get_wide_grid()
    if g is None:
        raise HTTPException(503, "bathymetry grid unavailable")
    # crop to the render window
    r0, r1 = int(round((LAT_BOT - g.lat0) / g.step)), int(round((LAT_TOP - g.lat0) / g.step))
    c0, c1 = int(round((LON_L - g.lon0) / g.step)), int(round((LON_R - g.lon0) / g.step))
    z = g.z[r0:r1 + 1, c0:c1 + 1].astype(np.float32)
    ny, nx = z.shape
    out_h = int(OUT_W * (_merc(LAT_TOP) - _merc(LAT_BOT)) / np.radians(LON_R - LON_L))
    # output rows are equally spaced in Mercator-y → convert back to latitude → source row index
    ys = np.linspace(_merc(LAT_TOP), _merc(LAT_BOT), out_h)
    lats = np.degrees(2 * np.arctan(np.exp(ys)) - np.pi / 2)
    rows = (lats - LAT_BOT) / g.step
    cols = np.linspace(0, nx - 1, OUT_W)
    rr, cc = np.meshgrid(rows, cols, indexing="ij")
    zs = map_coordinates(gaussian_filter(z, 0.6), [rr, cc], order=3, mode="nearest")
    depth = np.maximum(-zs, 0.0)
    # soft shoreline: alpha ramps over the first ~6 m of water
    alpha = np.clip(depth / 6.0, 0, 1) ** 0.8
    ramp = RAMPS[scheme]
    xs = np.array([p[0] for p in ramp], float); cols_rgb = np.array([p[1] for p in ramp], float)
    t = np.log1p(depth) / np.log1p(1.0)  # placeholder to keep shapes; real interpolation below
    rgb = np.stack([np.interp(np.log1p(depth), np.log1p(xs), cols_rgb[:, k]) for k in range(3)], axis=-1)
    img = np.dstack([rgb, alpha * 255]).astype(np.float32)
    # faint isobaths
    iso_r, iso_g, iso_b, iso_a = ISOBATH[scheme]
    line = np.zeros_like(depth)
    for lv in LEVELS:
        m = gaussian_filter((depth > lv).astype(np.float32), 1.1)
        line = np.maximum(line, 1 - np.clip(np.abs(m - 0.5) / 0.18, 0, 1))
    line *= (depth > 20)
    if region == "wide":
        line *= 0  # isobaths on the coarse 0.1° grid look like noise
    for k, v in enumerate((iso_r, iso_g, iso_b)):
        img[..., k] = img[..., k] * (1 - line * 0.6) + v * line * 0.6
    img[..., 3] = np.maximum(img[..., 3], line * iso_a * (alpha > 0.5))
    if region == "wide":
        t_lat, b_lat, l_lon, r_lon, _ = REGIONS["india"]
        lons = np.linspace(LON_L, LON_R, OUT_W)
        m = 0.3  # inset so the two images overlap slightly (no hairline seam)
        inside = (lats[:, None] <= t_lat - m) & (lats[:, None] >= b_lat + m) & (lons[None, :] >= l_lon + m) & (lons[None, :] <= r_lon - m)
        img[..., 3] = np.where(inside, 0, img[..., 3])
    buf = io.BytesIO()
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8), "RGBA").save(buf, "PNG", optimize=True)
    return buf.getvalue()


@router.get("/meta")
async def meta():
    """Corner coordinates ([TL, TR, BR, BL] as [lon, lat]) for MapLibre `image` sources."""
    out = {}
    for k, (t, b, l, r, _) in REGIONS.items():
        out[k] = [[l, t], [r, t], [r, b], [l, b]]
    return {"regions": out, "source": "NOAA ETOPO"}


@router.get("/overlay.png")
async def overlay(scheme: str = "dark", region: str = "india"):
    if scheme not in RAMPS or region not in REGIONS:
        raise HTTPException(400, "scheme must be light|dark and region india|wide")
    os.makedirs(_CACHE_DIR, exist_ok=True)
    path = os.path.join(_CACHE_DIR, f"bathy_{region}_{scheme}_v4.png")
    if not os.path.exists(path):
        if region == "wide" and get_wide_grid() is None:
            raise HTTPException(503, "wide bathymetry grid not available")
        open(path, "wb").write(_render(scheme, region))
    return Response(open(path, "rb").read(), media_type="image/png", headers={"Cache-Control": "public, max-age=86400"})

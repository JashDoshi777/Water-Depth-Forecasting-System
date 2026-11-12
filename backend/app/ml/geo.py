"""Geospatial feature engineering on a real bathymetry/topography grid.

Grid: NOAA ETOPO (via ERDDAP etopo180), 0.05° (~5.5 km), India + adjacent seas.
Provides: elevation/bathymetry lookup (bilinear), elevation gradient, geodesic
distance to the nearest shoreline (pyproj.Geod, as in the project brief) and
distance to the nearest major-river waypoint (basin-connectivity proxy).
"""
from __future__ import annotations

import os
from functools import lru_cache

import numpy as np

_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "etopo_india.npz")


class Grid:
    def __init__(self, lat0, lon0, step, z):
        self.lat0, self.lon0, self.step = float(lat0), float(lon0), float(step)
        self.z = z.astype(np.float32)                    # metres, <0 = below sea level
        self.ny, self.nx = z.shape
        self.lats = self.lat0 + np.arange(self.ny) * self.step
        self.lons = self.lon0 + np.arange(self.nx) * self.step
        gy, gx = np.gradient(self.z, self.step * 111.0, self.step * 111.0)   # m per km
        self.slope = np.hypot(gx, gy)
        self._coast = None

    def _idx(self, lat, lon):
        fy = (np.asarray(lat, float) - self.lat0) / self.step
        fx = (np.asarray(lon, float) - self.lon0) / self.step
        return np.clip(fy, 0, self.ny - 1.001), np.clip(fx, 0, self.nx - 1.001)

    def _bilinear(self, arr, lat, lon):
        fy, fx = self._idx(lat, lon)
        y0, x0 = np.floor(fy).astype(int), np.floor(fx).astype(int)
        wy, wx = fy - y0, fx - x0
        return (arr[y0, x0] * (1 - wy) * (1 - wx) + arr[y0 + 1, x0] * wy * (1 - wx)
                + arr[y0, x0 + 1] * (1 - wy) * wx + arr[y0 + 1, x0 + 1] * wy * wx)

    def elevation(self, lat, lon):
        """Metres; negative = ocean depth."""
        return self._bilinear(self.z, lat, lon)

    def gradient(self, lat, lon):
        """Terrain / seabed slope in metres per km."""
        return self._bilinear(self.slope, lat, lon)

    def _coast_index(self):
        if self._coast is None:
            from scipy.ndimage import distance_transform_edt
            ocean = self.z < 0
            # distance from every cell to the nearest cell of the opposite class
            _, ind_to_ocean = distance_transform_edt(~ocean, return_indices=True)   # land → nearest ocean
            _, ind_to_land = distance_transform_edt(ocean, return_indices=True)     # ocean → nearest land
            self._coast = (ocean, ind_to_ocean, ind_to_land)
        return self._coast

    def nearest_shore(self, lat, lon):
        """(lat, lon) of the nearest shoreline cell for each point."""
        lat = np.atleast_1d(np.asarray(lat, float)); lon = np.atleast_1d(np.asarray(lon, float))
        ocean, to_ocean, to_land = self._coast_index()
        fy, fx = self._idx(lat, lon)
        iy, ix = np.rint(fy).astype(int), np.rint(fx).astype(int)
        is_ocean = ocean[iy, ix]
        ty = np.where(is_ocean, to_land[0][iy, ix], to_ocean[0][iy, ix])
        tx = np.where(is_ocean, to_land[1][iy, ix], to_ocean[1][iy, ix])
        return self.lats[ty], self.lons[tx]

    def coastal_relief(self, lat, lon):
        """Land-only coastal-relief proxies (known even where the seabed is unsurveyed):
        elevation at the point mirrored across the shoreline, and terrain slope at the shoreline."""
        lat = np.atleast_1d(np.asarray(lat, float)); lon = np.atleast_1d(np.asarray(lon, float))
        slat, slon = self.nearest_shore(lat, lon)
        mirror = np.maximum(self.elevation(2 * slat - lat, 2 * slon - lon), 0.0)   # land elevation only
        return mirror, self.gradient(slat, slon)

    def shore_distance_km(self, lat, lon):
        """Geodesic distance (km, WGS84 via pyproj.Geod) to the nearest shoreline cell."""
        from pyproj import Geod
        g = Geod(ellps="WGS84")
        lat = np.atleast_1d(np.asarray(lat, float)); lon = np.atleast_1d(np.asarray(lon, float))
        slat, slon = self.nearest_shore(lat, lon)
        _, _, d = g.inv(lon, lat, slon, slat)
        return d / 1000.0


@lru_cache(maxsize=1)
def get_wide_grid() -> Grid | None:
    """Coarser (0.1°) grid over South/Southeast Asia + Indian Ocean, for zoomed-out map shading."""
    p = os.path.join(os.path.dirname(__file__), "..", "data", "etopo_wide.npz")
    if not os.path.exists(p):
        return None
    d = np.load(p)
    return Grid(d["lat0"], d["lon0"], d["step"], d["z"])


@lru_cache(maxsize=1)
def get_grid() -> Grid | None:
    if not os.path.exists(_PATH):
        return None
    d = np.load(_PATH)
    return Grid(d["lat0"], d["lon0"], d["step"], d["z"])


def river_distance_km(lat, lon) -> np.ndarray:
    """Distance (km) to the nearest major-river waypoint — a basin-connectivity proxy."""
    from app.services.digipin_grid import _RIVERS
    pts = np.array([(w[0], w[1]) for wps in _RIVERS.values() for w in wps])
    lat = np.atleast_1d(np.asarray(lat, float)); lon = np.atleast_1d(np.asarray(lon, float))
    dy = (lat[:, None] - pts[None, :, 0]) * 111.0
    dx = (lon[:, None] - pts[None, :, 1]) * 111.0 * np.cos(np.radians(lat))[:, None]
    return np.sqrt(dy * dy + dx * dx).min(axis=1)

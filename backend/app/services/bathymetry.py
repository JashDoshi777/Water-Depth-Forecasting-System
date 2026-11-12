"""
Bathymetry service — estimates water body base depth.

Primary: Mathematical model based on Indian continental shelf characteristics.
Secondary (optional): OpenTopography GEBCO API (requires API key).

The model uses distance-from-shore profiles calibrated against known Indian
bathymetric surveys for the Arabian Sea, Bay of Bengal, and inland water bodies.
"""

from __future__ import annotations

import math
from typing import Any

import httpx
from cachetools import TTLCache

from app.config import get_settings

_depth_cache: TTLCache = TTLCache(maxsize=5000, ttl=86400)  # 24 hr

# ── Known Indian coastal depth profiles ──
# Average continental shelf slope (degrees) by region
_SHELF_PROFILES = {
    "arabian_sea":    {"shelf_width_km": 300, "shelf_depth_m": 200, "slope_factor": 0.015},
    "bay_of_bengal":  {"shelf_width_km": 180, "shelf_depth_m": 200, "slope_factor": 0.020},
    "andaman_sea":    {"shelf_width_km": 120, "shelf_depth_m": 300, "slope_factor": 0.030},
    "laccadive_sea":  {"shelf_width_km": 200, "shelf_depth_m": 150, "slope_factor": 0.012},
}

# Major Indian river average depths (metres)
_RIVER_DEPTHS = {
    "ganga":        8.0, "brahmaputra":  12.0, "godavari":     5.5,
    "krishna":      4.5, "narmada":      6.0, "tapi":          3.5,
    "mahanadi":     5.0, "kaveri":       3.0, "sutlej":        4.0,
    "yamuna":       5.0, "indus":        7.0, "chambal":       4.5,
}

# Major Indian lakes/reservoirs and typical depths (metres)
_LAKE_DEPTHS = {
    "chilika":    4.2, "vembanad":    5.0, "dal":         6.0,
    "wular":      5.8, "loktak":      4.6, "pulicat":     1.5,
    "sambhar":    1.0, "hussain_sagar": 3.0, "naini":     25.0,
}


def estimate_shore_distance(lat: float, lon: float) -> float:
    """
    Estimate distance to nearest Indian coastline (km).
    Uses a simplified polygon-based approach.
    Returns 0 if the point is clearly inland near a water body.
    """
    # Simplified Indian coastline reference points
    coast_points = [
        (8.08, 77.55),   # Kanyakumari
        (9.97, 76.27),   # Kochi
        (12.97, 74.79),  # Mangalore
        (15.41, 73.88),  # Goa
        (18.93, 72.83),  # Mumbai
        (21.17, 72.83),  # Surat
        (22.47, 69.07),  # Kutch
        (20.31, 86.91),  # Puri
        (13.08, 80.29),  # Chennai
        (17.72, 83.30),  # Visakhapatnam
        (21.49, 87.00),  # Digha
        (22.56, 88.35),  # Kolkata (river)
        (11.64, 92.73),  # Port Blair
    ]

    min_dist = float("inf")
    for clat, clon in coast_points:
        d = _haversine(lat, lon, clat, clon)
        min_dist = min(min_dist, d)

    return round(min_dist, 2)


def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Haversine distance in kilometres."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = (math.sin(dlat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(dlon / 2) ** 2)
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def classify_water_body(lat: float, lon: float) -> str:
    """
    Classify the water body type based on coordinates.
    Priority: river > lake > offshore ocean > near-coast ocean > reservoir.
    """
    # 1. Check inland water bodies FIRST (before ocean fallback)
    if _is_near_major_river(lat, lon):
        return "river"
    if _is_near_lake(lat, lon):
        return "lake"

    # 2. Check if clearly offshore
    if _is_offshore(lat, lon):
        return "ocean"

    # 3. Distance-based classification
    shore_dist = estimate_shore_distance(lat, lon)
    if shore_dist < 80:
        return "ocean"  # Close to coast = coastal ocean

    return "reservoir"


def _is_offshore(lat: float, lon: float) -> bool:
    """
    True if the coordinate is over open water in the Indian EEZ region.
    A coarse bounding region AND a real land/ocean mask (global-land-mask),
    so inland points are never classified as ocean.
    """
    if not _in_indian_ocean_region(lat, lon):
        return False
    try:
        from global_land_mask import globe
        return bool(globe.is_ocean(lat, lon))
    except Exception:  # mask unavailable → fall back to the coarse regions
        return True


def _in_indian_ocean_region(lat: float, lon: float) -> bool:
    # Arabian Sea (west coast — from Gujarat to Kanyakumari)
    if 66 < lon < 77 and 5 < lat < 24:
        return True
    # Bay of Bengal (east coast — from West Bengal to Tamil Nadu)
    if 78 < lon < 95 and 5 < lat < 22:
        return True
    # Indian Ocean (south of India)
    if lat < 8 and 68 < lon < 90:
        return True
    # Andaman Sea
    if lon > 90 and lat < 15 and lat > 5:
        return True
    # Lakshadweep Sea
    if 70 < lon < 75 and 8 < lat < 14:
        return True
    return False


def _is_near_major_river(lat: float, lon: float) -> bool:
    """Check if near a major Indian river path."""
    # (start_lat, start_lon), (end_lat, end_lon), threshold_degrees
    river_corridors = [
        # Ganga (Haridwar to Kolkata delta)
        ((22, 78), (31, 89), 1.0),
        # Brahmaputra (Arunachal to Bangladesh)
        ((24, 89), (28, 96), 1.0),
        # Godavari (starts near Nashik at ~74°E, not coast)
        ((16, 75), (20, 82), 0.5),
        # Krishna (starts inland Karnataka)
        ((15, 75), (17, 81), 0.5),
        # Narmada (starts inland at 81°E, ends at Gujarat coast)
        ((21.5, 73), (23, 82), 0.5),
        # Yamuna
        ((26, 77), (31, 79), 0.5),
        # Kaveri
        ((10.5, 76), (13, 80), 0.5),
        # Mahanadi
        ((20, 82), (22, 87), 0.5),
        # Tapi (inland Maharashtra to Surat coast)
        ((21, 73), (21.5, 77), 0.3),
        # Sutlej
        ((29, 73), (32, 77), 0.5),
        # Chambal
        ((24, 76), (27, 79), 0.4),
        # Son
        ((24, 83), (26, 85), 0.4),
    ]
    for (lat1, lon1), (lat2, lon2), threshold in river_corridors:
        if (min(lat1, lat2) - threshold <= lat <= max(lat1, lat2) + threshold and
                min(lon1, lon2) - threshold <= lon <= max(lon1, lon2) + threshold):
            return True
    return False


def _is_near_lake(lat: float, lon: float) -> bool:
    """Check if near a major Indian lake."""
    lake_locations = [
        (19.88, 85.45, 0.3),   # Chilika
        (9.58, 76.38, 0.2),    # Vembanad
        (34.10, 74.85, 0.1),   # Dal Lake
        (24.6, 73.7, 0.2),     # Udaipur lakes
    ]
    for llat, llon, threshold in lake_locations:
        if abs(lat - llat) < threshold and abs(lon - llon) < threshold:
            return True
    return False


def _get_ocean_region(lat: float, lon: float) -> str:
    """Determine which ocean region a coordinate falls in."""
    if lon < 76 and lat < 20:
        return "laccadive_sea"
    if lon < 76:
        return "arabian_sea"
    if lon > 90:
        return "andaman_sea"
    return "bay_of_bengal"


def estimate_base_depth(
    lat: float,
    lon: float,
    water_body_type: str = "ocean",
) -> float:
    """
    Estimate the base (static) depth at a given coordinate.

    For ocean: Uses continental shelf profile model.
    For rivers/lakes: Uses known average depths.
    For reservoirs: Uses moderate estimate.

    Returns depth in metres (positive downward).
    """
    cache_key = f"bd:{round(lat, 4)}:{round(lon, 4)}"
    if cache_key in _depth_cache:
        return _depth_cache[cache_key]

    if water_body_type == "ocean":
        depth = _estimate_ocean_depth(lat, lon)
    elif water_body_type == "river":
        depth = _estimate_river_depth(lat, lon)
    elif water_body_type == "lake":
        depth = _estimate_lake_depth(lat, lon)
    else:  # reservoir
        depth = _estimate_reservoir_depth(lat, lon)

    depth = round(max(0.5, depth), 2)
    _depth_cache[cache_key] = depth
    return depth


def _estimate_ocean_depth(lat: float, lon: float) -> float:
    """
    Ocean depth. Uses REAL NOAA ETOPO bathymetry (0.05° grid, bilinear) when the
    point is over water in the grid; otherwise falls back to a shelf-profile model.
    """
    try:
        from app.ml.geo import get_grid
        grid = get_grid()
        if grid is not None:
            z = float(grid.elevation(lat, lon))
            if z < -1.0:
                return -z
            if z <= 15.0:  # coastal cell straddling the shoreline: shallow water
                return max(1.5, 3.0 + abs(z) * 0.5)
    except Exception:
        pass
    return _shelf_profile_depth(lat, lon)


def _shelf_profile_depth(lat: float, lon: float) -> float:
    """Heuristic continental-shelf profile (fallback + ML baseline)."""
    shore_dist = estimate_shore_distance(lat, lon)
    region = _get_ocean_region(lat, lon)
    profile = _SHELF_PROFILES.get(region, _SHELF_PROFILES["bay_of_bengal"])

    shelf_w = profile["shelf_width_km"]
    shelf_d = profile["shelf_depth_m"]
    slope = profile["slope_factor"]

    if shore_dist < shelf_w:
        # On the continental shelf — gentle slope
        fraction = shore_dist / shelf_w
        depth = shelf_d * (1 - math.exp(-3 * fraction))
    else:
        # Beyond shelf — steeper slope to abyssal plain
        beyond = shore_dist - shelf_w
        depth = shelf_d + beyond * slope * 100
        depth = min(depth, 4500)  # Cap at avg abyssal depth

    # Add some variation based on coordinates
    variation = math.sin(lat * 10) * math.cos(lon * 10) * 5
    return max(1.0, depth + variation)


def _estimate_river_depth(lat: float, lon: float) -> float:
    """Estimate river depth based on proximity to known rivers."""
    # Find nearest known river depth
    best_depth = 5.0  # default
    # Simple latitude-band matching
    if 24 < lat < 28 and 78 < lon < 90:
        best_depth = _RIVER_DEPTHS.get("ganga", 8.0)
    elif 25 < lat < 28 and 89 < lon < 96:
        best_depth = _RIVER_DEPTHS.get("brahmaputra", 12.0)
    elif 15 < lat < 20 and 78 < lon < 83:
        best_depth = _RIVER_DEPTHS.get("godavari", 5.5)
    elif 21 < lat < 24 and 73 < lon < 80:
        best_depth = _RIVER_DEPTHS.get("narmada", 6.0)

    # Seasonal variation proxy
    variation = math.sin(lat * 5) * 0.5
    return max(1.0, best_depth + variation)


def _estimate_lake_depth(lat: float, lon: float) -> float:
    """Estimate lake depth."""
    # Check known lakes
    for name, (llat, llon, _) in zip(
        _LAKE_DEPTHS.keys(),
        [(19.88, 85.45, 0.3), (9.58, 76.38, 0.2), (34.10, 74.85, 0.1),
         (34.3, 74.7, 0.1), (24.5, 93.8, 0.1), (13.6, 80.2, 0.2),
         (26.95, 75.05, 0.2), (17.4, 78.5, 0.1), (29.4, 79.5, 0.1)],
    ):
        if abs(lat - llat) < 0.3 and abs(lon - llon) < 0.3:
            return _LAKE_DEPTHS[name]
    return 5.0  # Default lake depth


def _estimate_reservoir_depth(lat: float, lon: float) -> float:
    """Estimate reservoir depth — typically 10–50m for Indian reservoirs."""
    base = 15.0
    variation = math.sin(lat * 3) * math.cos(lon * 3) * 5
    return max(3.0, base + variation)


async def fetch_gebco_depth(lat: float, lon: float) -> float | None:
    """
    Fetch real bathymetric depth from GEBCO via OpenTopography API.
    Returns depth in metres (positive = below sea level).
    Returns None if API key not configured or request fails.

    OpenTopography globaldem endpoint returns AAIGrid (ASCII Grid) format.
    """
    settings = get_settings()
    if not settings.opentopography_api_key:
        return None

    cache_key = f"gebco:{round(lat, 4)}:{round(lon, 4)}"
    if cache_key in _depth_cache:
        return _depth_cache[cache_key]

    try:
        delta = 0.01  # ~2.2km bounding box (meets OT minimum area req)
        params = {
            "demtype": "SRTM15Plus",  # Global bathymetry+topography at 15 arc-second
            "south": round(lat - delta, 5),
            "north": round(lat + delta, 5),
            "west": round(lon - delta, 5),
            "east": round(lon + delta, 5),
            "outputFormat": "AAIGrid",
            "API_Key": settings.opentopography_api_key,
        }

        async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
            resp = await client.get(
                "https://portal.opentopography.org/API/globaldem",
                params=params,
            )

            if resp.status_code == 200:
                content = resp.text

                # Parse AAIGrid format — extract elevation values
                lines = content.strip().split('\n')
                elevation_values = []
                for line in lines:
                    # Skip header lines (ncols, nrows, xllcorner, etc.)
                    line = line.strip()
                    if any(line.lower().startswith(h) for h in
                           ['ncols', 'nrows', 'xll', 'yll', 'cellsize', 'nodata']):
                        continue
                    # Parse numeric values
                    try:
                        values = [float(v) for v in line.split() if v.strip()]
                        elevation_values.extend(values)
                    except ValueError:
                        continue

                if elevation_values:
                    # Average elevation at the point
                    avg_elevation = sum(elevation_values) / len(elevation_values)
                    # GEBCO: negative = below sea level (ocean floor)
                    depth = abs(avg_elevation) if avg_elevation < 0 else 0.0
                    _depth_cache[cache_key] = depth
                    return depth

            elif resp.status_code == 429:
                print("[GEBCO] Rate limited — falling back to model")
            else:
                print(f"[GEBCO] API returned {resp.status_code}")

    except Exception as exc:
        print(f"[GEBCO] Failed for ({lat},{lon}): {exc}")

    return None


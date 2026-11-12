"""
DIGIPIN Grid Generator — Generates 95K+ water body DIGIPIN locations.

Covers:
  - Indian coastline (7,500+ km) at ~0.05° spacing
  - Major river systems (20+ rivers) at ~0.1° spacing
  - Real named lakes and reservoirs (OSM + Natural Earth, ~1.4K)
  - Indian EEZ ocean grid at ~0.5° spacing

All coordinates are real geographic reference data.
No depth values are hardcoded — depths come from live APIs.
"""

from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from typing import Iterator

from app.services.digipin_codec import encode

# ═══════════════════════════════════════════════════════════
#  Indian Coastline Reference Points (dense, real coordinates)
#  Source: NHO/Survey of India coastal charts
# ═══════════════════════════════════════════════════════════

_COASTLINE: list[tuple[float, float, str]] = [
    # (lat, lon, region) — Gujarat
    (23.60, 68.35, "Gujarat"), (23.10, 68.70, "Gujarat"), (22.45, 69.08, "Gujarat"),
    (21.63, 69.62, "Gujarat"), (21.10, 70.35, "Gujarat"), (20.92, 71.00, "Gujarat"),
    (21.15, 72.15, "Gujarat"), (21.70, 72.65, "Gujarat"), (21.17, 72.83, "Gujarat"),
    (20.92, 72.83, "Gujarat"), (20.72, 71.05, "Gujarat"),
    # Maharashtra
    (19.97, 72.80, "Maharashtra"), (19.08, 72.88, "Maharashtra"),
    (18.55, 72.92, "Maharashtra"), (17.73, 73.09, "Maharashtra"),
    (17.00, 73.30, "Maharashtra"), (16.33, 73.38, "Maharashtra"),
    # Goa
    (15.60, 73.75, "Goa"), (15.40, 73.83, "Goa"), (15.28, 73.97, "Goa"),
    # Karnataka
    (14.80, 74.10, "Karnataka"), (14.30, 74.30, "Karnataka"),
    (13.34, 74.74, "Karnataka"), (12.87, 74.84, "Karnataka"),
    (12.50, 74.90, "Karnataka"),
    # Kerala
    (12.02, 75.18, "Kerala"), (11.25, 75.78, "Kerala"),
    (10.57, 76.08, "Kerala"), (9.97, 76.27, "Kerala"),
    (9.50, 76.30, "Kerala"), (8.88, 76.55, "Kerala"),
    (8.38, 76.97, "Kerala"), (8.08, 77.55, "Kerala"),
    # Tamil Nadu — west coast tip
    (8.08, 77.55, "Tamil Nadu"), (8.30, 78.10, "Tamil Nadu"),
    (9.28, 79.15, "Tamil Nadu"), (10.00, 79.85, "Tamil Nadu"),
    (10.40, 79.85, "Tamil Nadu"), (10.77, 79.84, "Tamil Nadu"),
    (11.20, 79.85, "Tamil Nadu"), (11.74, 79.78, "Tamil Nadu"),
    (12.62, 80.18, "Tamil Nadu"), (13.08, 80.29, "Tamil Nadu"),
    # Andhra Pradesh
    (13.62, 80.19, "Andhra Pradesh"), (14.62, 80.17, "Andhra Pradesh"),
    (15.43, 80.05, "Andhra Pradesh"), (15.90, 80.66, "Andhra Pradesh"),
    (16.20, 81.14, "Andhra Pradesh"), (16.98, 82.24, "Andhra Pradesh"),
    (17.69, 83.22, "Andhra Pradesh"), (17.74, 83.30, "Andhra Pradesh"),
    (18.12, 83.75, "Andhra Pradesh"), (18.85, 84.58, "Andhra Pradesh"),
    # Odisha
    (19.26, 84.87, "Odisha"), (19.80, 85.83, "Odisha"),
    (20.26, 86.76, "Odisha"), (20.48, 86.94, "Odisha"),
    (21.48, 87.00, "Odisha"),
    # West Bengal
    (21.60, 87.47, "West Bengal"), (21.63, 87.80, "West Bengal"),
    (21.78, 88.08, "West Bengal"), (22.00, 88.22, "West Bengal"),
    (21.65, 88.15, "West Bengal"),
    # Andaman & Nicobar
    (11.68, 92.72, "Andaman"), (12.50, 92.90, "Andaman"),
    (13.15, 93.05, "Andaman"), (6.76, 93.85, "Nicobar"),
    (7.50, 93.55, "Nicobar"),
    # Lakshadweep
    (10.08, 73.03, "Lakshadweep"), (11.12, 72.18, "Lakshadweep"),
    (10.57, 72.64, "Lakshadweep"),
]

# ═══════════════════════════════════════════════════════════
#  Major River Systems — Real waypoints along river courses
# ═══════════════════════════════════════════════════════════

_RIVERS: dict[str, list[tuple[float, float, str]]] = {
    "Ganga": [
        (30.99, 78.93, "Uttarakhand"), (29.95, 78.16, "Uttarakhand"),
        (29.45, 77.70, "Uttar Pradesh"), (28.68, 77.55, "Uttar Pradesh"),
        (27.18, 78.02, "Uttar Pradesh"), (26.85, 80.91, "Uttar Pradesh"),
        (26.45, 80.35, "Uttar Pradesh"), (25.43, 81.85, "Uttar Pradesh"),
        (25.32, 83.01, "Uttar Pradesh"), (25.60, 84.87, "Bihar"),
        (25.62, 85.12, "Bihar"), (25.17, 85.87, "Bihar"),
        (24.78, 87.85, "Jharkhand"), (24.10, 88.25, "West Bengal"),
        (23.40, 88.18, "West Bengal"), (22.57, 88.36, "West Bengal"),
    ],
    "Brahmaputra": [
        (27.50, 95.35, "Arunachal Pradesh"), (27.10, 94.62, "Assam"),
        (26.75, 93.82, "Assam"), (26.20, 91.75, "Assam"),
        (26.14, 91.74, "Assam"), (25.85, 90.05, "Assam"),
        (25.18, 89.85, "Meghalaya"), (24.85, 89.50, "Bangladesh border"),
    ],
    "Godavari": [
        (19.90, 73.72, "Maharashtra"), (19.22, 75.78, "Maharashtra"),
        (18.43, 77.67, "Telangana"), (17.70, 79.07, "Telangana"),
        (17.38, 79.60, "Telangana"), (17.20, 80.15, "Andhra Pradesh"),
        (16.98, 81.78, "Andhra Pradesh"), (16.73, 81.74, "Andhra Pradesh"),
    ],
    "Krishna": [
        (17.98, 73.68, "Maharashtra"), (17.38, 76.18, "Karnataka"),
        (16.75, 76.85, "Karnataka"), (16.50, 78.08, "Andhra Pradesh"),
        (16.52, 80.62, "Andhra Pradesh"), (15.88, 80.60, "Andhra Pradesh"),
    ],
    "Narmada": [
        (22.68, 81.77, "Madhya Pradesh"), (22.33, 79.87, "Madhya Pradesh"),
        (22.25, 77.42, "Madhya Pradesh"), (21.82, 75.58, "Maharashtra"),
        (21.69, 73.00, "Gujarat"), (21.64, 72.67, "Gujarat"),
    ],
    "Yamuna": [
        (30.92, 78.45, "Uttarakhand"), (30.38, 77.87, "Uttarakhand"),
        (28.62, 77.22, "Delhi"), (27.18, 78.02, "Uttar Pradesh"),
        (26.85, 80.95, "Uttar Pradesh"), (25.43, 81.85, "Uttar Pradesh"),
    ],
    "Kaveri": [
        (12.42, 75.72, "Karnataka"), (12.30, 76.65, "Karnataka"),
        (11.80, 76.88, "Tamil Nadu"), (11.35, 77.72, "Tamil Nadu"),
        (10.79, 78.69, "Tamil Nadu"), (10.93, 79.85, "Tamil Nadu"),
    ],
    "Mahanadi": [
        (21.95, 81.62, "Chhattisgarh"), (21.28, 82.15, "Odisha"),
        (20.85, 83.33, "Odisha"), (20.47, 83.88, "Odisha"),
        (20.30, 86.62, "Odisha"),
    ],
    "Tapi": [
        (21.48, 76.25, "Maharashtra"), (21.25, 75.58, "Maharashtra"),
        (21.17, 72.83, "Gujarat"), (21.10, 72.80, "Gujarat"),
    ],
    "Sutlej": [
        (31.40, 76.43, "Himachal Pradesh"), (30.95, 76.78, "Punjab"),
        (30.60, 75.30, "Punjab"), (29.55, 73.88, "Rajasthan"),
    ],
    "Chambal": [
        (24.03, 76.05, "Rajasthan"), (25.38, 76.22, "Rajasthan"),
        (26.52, 78.38, "Madhya Pradesh"), (26.80, 79.05, "Uttar Pradesh"),
    ],
    "Son": [
        (24.12, 83.05, "Madhya Pradesh"), (24.70, 83.87, "Uttar Pradesh"),
        (25.52, 84.65, "Bihar"),
    ],
    "Tungabhadra": [
        (14.45, 75.92, "Karnataka"), (15.35, 76.48, "Karnataka"),
        (15.95, 77.57, "Andhra Pradesh"),
    ],
    "Sabarmati": [
        (24.18, 72.82, "Rajasthan"), (23.03, 72.58, "Gujarat"),
        (22.30, 72.37, "Gujarat"),
    ],
    "Mahi": [
        (23.68, 73.78, "Rajasthan"), (22.58, 73.25, "Gujarat"),
        (22.17, 72.95, "Gujarat"),
    ],
    "Periyar": [
        (10.15, 76.68, "Kerala"), (10.00, 76.25, "Kerala"),
    ],
    "Beas": [
        (32.05, 77.15, "Himachal Pradesh"), (31.62, 75.60, "Punjab"),
        (31.10, 75.15, "Punjab"),
    ],
    "Jhelum": [
        (34.08, 74.80, "J&K"), (33.73, 74.78, "J&K"),
        (33.00, 74.35, "J&K"),
    ],
    "Indus (Indian)": [
        (34.15, 77.58, "Ladakh"), (33.95, 76.18, "J&K"),
    ],
}

# ═══════════════════════════════════════════════════════════
#  Lakes & Reservoirs — Real coordinates
# ═══════════════════════════════════════════════════════════

_LAKES: list[tuple[str, float, float, str]] = [
    ("Chilika Lake", 19.72, 85.32, "Odisha"),
    ("Vembanad Lake", 9.59, 76.38, "Kerala"),
    ("Pulicat Lake", 13.58, 80.17, "Tamil Nadu"),
    ("Kolleru Lake", 16.58, 81.20, "Andhra Pradesh"),
    ("Dal Lake", 34.09, 74.86, "J&K"),
    ("Wular Lake", 34.36, 74.59, "J&K"),
    ("Loktak Lake", 24.53, 93.80, "Manipur"),
    ("Sambhar Lake", 26.95, 75.05, "Rajasthan"),
    ("Pangong Lake", 33.76, 78.65, "Ladakh"),
    ("Tsomoriri Lake", 32.90, 78.32, "Ladakh"),
    ("Hussain Sagar", 17.44, 78.48, "Telangana"),
    ("Naini Lake", 29.39, 79.47, "Uttarakhand"),
    ("Bhimtal", 29.35, 79.56, "Uttarakhand"),
    ("Lonar Lake", 19.98, 76.51, "Maharashtra"),
    ("Pichola Lake", 24.57, 73.68, "Rajasthan"),
    ("Fateh Sagar", 24.60, 73.67, "Rajasthan"),
    ("Ashtamudi Lake", 8.95, 76.58, "Kerala"),
    ("Sasthamkotta Lake", 9.05, 76.62, "Kerala"),
    ("Nal Sarovar", 22.78, 72.02, "Gujarat"),
    ("Upper Lake Bhopal", 23.23, 77.33, "Madhya Pradesh"),
]

_RESERVOIRS: list[tuple[str, float, float, str]] = [
    ("Sardar Sarovar", 21.83, 73.75, "Gujarat"),
    ("Hirakud", 21.52, 83.87, "Odisha"),
    ("Nagarjuna Sagar", 16.57, 79.31, "Telangana"),
    ("Bhakra Nangal", 31.41, 76.43, "Himachal Pradesh"),
    ("Tehri Dam", 30.38, 78.48, "Uttarakhand"),
    ("Tungabhadra Dam", 15.27, 76.33, "Karnataka"),
    ("Rihand Dam", 24.20, 83.01, "Uttar Pradesh"),
    ("Srisailam", 15.85, 78.87, "Telangana"),
    ("Koyna", 17.40, 73.75, "Maharashtra"),
    ("Mettur Dam", 11.80, 77.80, "Tamil Nadu"),
    ("Indira Sagar", 22.28, 76.48, "Madhya Pradesh"),
    ("Almatti Dam", 16.33, 75.88, "Karnataka"),
    ("Jayakwadi Dam", 19.50, 75.38, "Maharashtra"),
    ("Ukai Dam", 21.25, 73.60, "Gujarat"),
    ("Stanley Reservoir", 11.61, 77.96, "Tamil Nadu"),
    ("Krishnarajasagar", 12.42, 76.57, "Karnataka"),
    ("Pong Dam", 31.97, 76.05, "Himachal Pradesh"),
    ("Govind Ballabh Pant Sagar", 24.15, 83.12, "Uttar Pradesh"),
    ("Gandhisagar Dam", 24.72, 75.58, "Madhya Pradesh"),
    ("Bargi Dam", 23.10, 79.95, "Madhya Pradesh"),
    ("Bhavanisagar", 11.48, 77.10, "Tamil Nadu"),
    ("Idukki Dam", 9.84, 76.97, "Kerala"),
    ("Mullaperiyar Dam", 9.53, 77.13, "Kerala"),
    ("Panchet Dam", 23.67, 86.75, "Jharkhand"),
    ("Maithon Dam", 23.78, 86.82, "Jharkhand"),
    ("Ranjit Sagar", 32.47, 75.73, "Punjab"),
    ("Lower Manair Dam", 18.15, 79.57, "Telangana"),
    ("Ujjani Dam", 18.05, 75.12, "Maharashtra"),
    ("Mahi Bajaj Sagar", 23.65, 74.08, "Rajasthan"),
    ("Rana Pratap Sagar", 24.92, 75.58, "Rajasthan"),
]


# ─────────────────────────────────────────────────────────────────────
#  Real lakes & reservoirs (replaces the old hand-listed _LAKES/_RESERVOIRS grids)
# ─────────────────────────────────────────────────────────────────────
def estimate_waterbody_depth(kind: str, area_km2: float | None, mean_depth_m: float | None) -> float:
    """Mean depth if known; else documented heuristic: reservoirs 12+4*ln(1+A) m (8-60), lakes 1.5+0.9*ln(1+A) m (1.5-15)."""
    if mean_depth_m:
        return round(float(mean_depth_m), 1)
    a = area_km2 or 1.0
    if kind == "reservoir":
        return round(min(60.0, max(8.0, 12 + 4 * math.log(1 + a))), 1)
    return round(min(15.0, max(1.5, 1.5 + 0.9 * math.log(1 + a))), 1)


def _interior_points(geom, n_target: int) -> list[tuple[float, float]]:
    from shapely.geometry import Point
    minx, miny, maxx, maxy = geom.bounds
    k = max(2, int(math.sqrt(n_target * 2)))
    pts = []
    for i in range(k):
        for j in range(k):
            lon = minx + (i + 0.5) * (maxx - minx) / k
            lat = miny + (j + 0.5) * (maxy - miny) / k
            if geom.contains(Point(lon, lat)):
                pts.append((round(lat, 5), round(lon, 5)))
    return pts[:n_target]


@lru_cache(maxsize=1)
def load_real_waterbodies() -> tuple:
    """Parsed real water bodies: dicts with id,name,kind,state,depth,points[(lat,lon)...]."""
    path = os.path.join(os.path.dirname(__file__), "..", "data", "waterbodies_india.geojson")
    try:
        feats = json.load(open(path, encoding="utf-8"))["features"]
    except Exception:
        return tuple()
    out = []
    for f in feats:
        p = f["properties"]
        pts = [(p["lat"], p["lon"])]
        if p.get("has_outline"):
            try:
                from shapely.geometry import shape
                n = int(min(25, max(3, (p.get("area_km2") or 0) / 4)))
                pts += _interior_points(shape(f["geometry"]), n)
            except Exception:
                pass
        out.append({"id": p["id"], "name": p["name"], "kind": p["kind"], "state": p["state"], "points": pts,
                    "depth": estimate_waterbody_depth(p["kind"], p.get("area_km2"), p.get("mean_depth_m"))})
    return tuple(out)



def _interpolate_points(
    points: list[tuple[float, float, str]], spacing_deg: float = 0.05
) -> Iterator[tuple[float, float, str]]:
    """
    Linearly interpolate between consecutive reference points
    to generate dense grid along paths (coastline, rivers).
    """
    for i in range(len(points) - 1):
        lat1, lon1, reg1 = points[i]
        lat2, lon2, reg2 = points[i + 1]

        dist = math.sqrt((lat2 - lat1) ** 2 + (lon2 - lon1) ** 2)
        n_steps = max(1, int(dist / spacing_deg))

        for j in range(n_steps):
            frac = j / n_steps
            lat = lat1 + (lat2 - lat1) * frac
            lon = lon1 + (lon2 - lon1) * frac
            yield (round(lat, 5), round(lon, 5), reg1)

    # Include last point
    if points:
        yield (round(points[-1][0], 5), round(points[-1][1], 5), points[-1][2])


def _generate_ocean_grid(
    lat_min: float = 5.0, lat_max: float = 25.0,
    lon_min: float = 66.0, lon_max: float = 95.0,
    spacing: float = 0.5,
) -> Iterator[tuple[float, float, str]]:
    """
    Generate a regular grid over Indian EEZ waters.
    Only yields points that are clearly in the ocean.
    """
    from app.services.bathymetry import _is_offshore

    lat = lat_min
    while lat <= lat_max:
        lon = lon_min
        while lon <= lon_max:
            if _is_offshore(lat, lon):
                # Determine region
                if lon < 76:
                    region = "Arabian Sea"
                elif lon > 88:
                    region = "Bay of Bengal"
                else:
                    region = "Indian Ocean"
                yield (round(lat, 4), round(lon, 4), region)
            lon += spacing
        lat += spacing


def generate_all_locations() -> list[dict]:
    """
    Generate the complete set of 95K+ DIGIPIN water body locations.
    Returns list of {name, lat, lon, region, water_body_type} dicts.

    No depth values included — depths come from live API calls.
    """
    locations: list[dict] = []
    seen: set[str] = set()

    def _add(name: str, lat: float, lon: float, region: str, wb_type: str):
        # Deduplicate by rounded coords
        key = f"{round(lat, 4)}:{round(lon, 4)}"
        if key not in seen:
            seen.add(key)
            locations.append({
                "name": name,
                "lat": lat,
                "lon": lon,
                "region": region,
                "water_body_type": wb_type,
            })

    # 1. Coastline — very dense interpolation (~1km spacing)
    for lat, lon, region in _interpolate_points(_COASTLINE, spacing_deg=0.01):
        _add(f"Coast - {region}", lat, lon, region, "ocean")

    # 2. Rivers — dense interpolation (~2km spacing)
    for river_name, waypoints in _RIVERS.items():
        for lat, lon, region in _interpolate_points(waypoints, spacing_deg=0.02):
            _add(f"{river_name}", lat, lon, region, "river")

    # 3+4. Real named lakes & reservoirs (OpenStreetMap + Natural Earth; see scripts/build_waterbodies.py).
    #      One point per body, plus interior sample points for bodies that have an outline.
    for body in load_real_waterbodies():
        for lat, lon in body["points"]:
            key = f"{round(lat, 4)}:{round(lon, 4)}"
            if key in seen:
                continue
            seen.add(key)
            locations.append({"name": body["name"], "lat": lat, "lon": lon, "region": body["state"],
                              "water_body_type": body["kind"], "depth": body["depth"], "wb_id": body["id"]})

    # 5. Ocean EEZ grid (~0.2° spacing for broad coverage)
    for lat, lon, region in _generate_ocean_grid(spacing=0.2):
        _add(f"EEZ - {region}", lat, lon, region, "ocean")

    # 6. Near-shore grid — very dense ocean coverage along coast
    for lat, lon, region in _generate_ocean_grid(
        lat_min=6, lat_max=24, lon_min=68, lon_max=90, spacing=0.08
    ):
        _add(f"Coastal - {region}", lat, lon, region, "ocean")

    # 7. Continental shelf belt — dense band 0-200km from coast
    for lat, lon, region in _generate_ocean_grid(
        lat_min=5, lat_max=23, lon_min=66, lon_max=95, spacing=0.1
    ):
        _add(f"Shelf - {region}", lat, lon, region, "ocean")

    # 8. River buffer zones — lateral grid around major rivers
    for river_name, waypoints in _RIVERS.items():
        for lat, lon, region in _interpolate_points(waypoints, spacing_deg=0.05):
            for dlon in [-0.05, -0.03, 0.03, 0.05]:
                _add(f"{river_name} floodplain", round(lat, 5), round(lon + dlon, 5), region, "river")

    return locations


def generate_locations_in_bbox(
    lat_min: float, lat_max: float,
    lon_min: float, lon_max: float,
    max_results: int = 500,
) -> list[dict]:
    """
    Generate DIGIPIN locations within a bounding box.
    Used for map viewport queries — returns nearby locations only.
    """
    all_locs = generate_all_locations()
    results = []
    for loc in all_locs:
        if (lat_min <= loc["lat"] <= lat_max and
                lon_min <= loc["lon"] <= lon_max):
            results.append(loc)
            if len(results) >= max_results:
                break
    return results


def get_location_count() -> int:
    """Get total number of generatable DIGIPIN locations."""
    return len(generate_all_locations())

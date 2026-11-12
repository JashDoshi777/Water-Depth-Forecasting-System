"""Location search and management API endpoints — dynamic, no hardcoded data."""

from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, HTTPException, Query
from app.services.digipin_codec import decode, encode, is_valid
from app.services.bathymetry import (
    classify_water_body,
    estimate_base_depth,
    estimate_shore_distance,
    _haversine,
)
from app.services.digipin_grid import (
    generate_all_locations,
    generate_locations_in_bbox,
    get_location_count,
)

router = APIRouter(prefix="/locations", tags=["Locations"])

# Major Indian cities → (lat, lon). Lets users search "mumbai" and get the
# nearest monitored water bodies, since grid points are named by region.
CITY_COORDS: dict[str, tuple[float, float]] = {
    "mumbai": (19.076, 72.878), "delhi": (28.614, 77.209), "new delhi": (28.614, 77.209),
    "kolkata": (22.572, 88.364), "chennai": (13.083, 80.270), "bengaluru": (12.972, 77.594),
    "bangalore": (12.972, 77.594), "hyderabad": (17.385, 78.487), "pune": (18.520, 73.857),
    "ahmedabad": (23.023, 72.572), "surat": (21.170, 72.831), "kochi": (9.931, 76.267),
    "cochin": (9.931, 76.267), "thiruvananthapuram": (8.524, 76.937), "goa": (15.499, 73.828),
    "panaji": (15.499, 73.828), "visakhapatnam": (17.687, 83.218), "vizag": (17.687, 83.218),
    "bhubaneswar": (20.296, 85.825), "puri": (19.813, 85.831), "mangaluru": (12.914, 74.856),
    "mangalore": (12.914, 74.856), "patna": (25.594, 85.138), "varanasi": (25.317, 82.973),
    "lucknow": (26.847, 80.947), "kanpur": (26.449, 80.332), "bhopal": (23.259, 77.413),
    "nagpur": (21.146, 79.088), "guwahati": (26.144, 91.736), "jaipur": (26.912, 75.787),
    "udaipur": (24.586, 73.713), "srinagar": (34.084, 74.797), "chandigarh": (30.733, 76.779),
    "haridwar": (29.945, 78.164), "rishikesh": (30.087, 78.268), "allahabad": (25.435, 81.846),
    "prayagraj": (25.435, 81.846), "vijayawada": (16.506, 80.648), "madurai": (9.925, 78.120),
    "coimbatore": (11.017, 76.956), "puducherry": (11.934, 79.830), "kozhikode": (11.259, 75.780),
    "rajkot": (22.303, 70.802), "kandla": (23.033, 70.217), "paradip": (20.316, 86.611),
    "tuticorin": (8.764, 78.134), "port blair": (11.623, 92.726),
}


# Cache the generated grid (computed once, reused)
@lru_cache(maxsize=1)
def _get_all_locations_cached() -> list[dict]:
    """Generate all locations once and cache."""
    return generate_all_locations()


# Pre-computed enriched cache — avoids recalculating depths every request
_enriched_cache: dict[str, dict] = {}


def _enrich_location(loc: dict) -> dict:
    """Add computed fields to a location — with memoization."""
    key = f"{loc['lat']:.5f}:{loc['lon']:.5f}"
    if key in _enriched_cache:
        return _enriched_cache[key]

    lat, lon = loc["lat"], loc["lon"]
    wb_type = loc.get("water_body_type") or classify_water_body(lat, lon)
    pin = encode(lat, lon)
    result = {
        "id": abs(hash(pin)) % 1000000,
        "digipin": pin,
        "latitude": lat,
        "longitude": lon,
        "water_body_type": wb_type,
        "name": loc["name"],
        "region": loc.get("region", ""),
        "base_depth": estimate_base_depth(lat, lon, wb_type),
        "shore_distance_km": estimate_shore_distance(lat, lon),
    }
    _enriched_cache[key] = result
    return result


@router.get("/all")
async def list_all_locations(
    limit: int = Query(default=100, ge=1, le=5000),
    offset: int = Query(default=0, ge=0),
    water_body_type: str = Query(default="", description="Filter: ocean, river, lake, reservoir"),
):
    """
    Return paginated DIGIPIN locations from the 100K+ grid.
    Supports filtering by water body type and pagination.
    """
    all_locs = _get_all_locations_cached()

    # Filter by type if specified
    if water_body_type:
        all_locs = [l for l in all_locs if l.get("water_body_type") == water_body_type]

    total = len(all_locs)
    page = all_locs[offset:offset + limit]

    return {
        "locations": [_enrich_location(l) for l in page],
        "total": total,
        "limit": limit,
        "offset": offset,
        "total_available": get_location_count(),
    }


@router.get("/search")
async def search_locations(
    q: str = "",
    water_body_type: str = "",
    limit: int = Query(default=50, ge=1, le=500),
):
    """Search locations by name, region, or type from the full 100K+ grid."""
    all_locs = _get_all_locations_cached()

    results = all_locs
    if q:
        q_lower = q.strip().lower()
        city = CITY_COORDS.get(q_lower)
        if city:
            near = []
            for l in all_locs:
                d = _haversine(city[0], city[1], l["lat"], l["lon"])
                if d <= 150 and (not water_body_type or l.get("water_body_type") == water_body_type):
                    near.append((d, l))
            near.sort(key=lambda x: x[0])
            out = []
            for d, l in near[:limit]:
                e = dict(_enrich_location(l))
                e["distance_km"] = round(d, 1)
                out.append(e)
            return {"locations": out, "total": len(near), "matched_city": q_lower.title()}
        results = [
            l for l in results
            if q_lower in l["name"].lower() or q_lower in l.get("region", "").lower()
        ]

    if water_body_type:
        results = [l for l in results if l.get("water_body_type") == water_body_type]

    return {
        "locations": [_enrich_location(l) for l in results[:limit]],
        "total": len(results),
    }


@router.get("/nearby")
async def find_nearby(
    latitude: float,
    longitude: float,
    radius_km: float = 100,
    limit: int = Query(default=50, ge=1, le=500),
):
    """Find locations within a radius of given coordinates."""
    all_locs = _get_all_locations_cached()

    results = []
    for loc in all_locs:
        dist = _haversine(latitude, longitude, loc["lat"], loc["lon"])
        if dist <= radius_km:
            enriched = _enrich_location(loc)
            enriched["distance_km"] = round(dist, 2)
            results.append(enriched)

    results.sort(key=lambda x: x["distance_km"])
    return {
        "locations": results[:limit],
        "total": len(results),
        "center": {"latitude": latitude, "longitude": longitude},
    }


@router.get("/bbox")
async def get_locations_in_bbox(
    lat_min: float = Query(...),
    lat_max: float = Query(...),
    lon_min: float = Query(...),
    lon_max: float = Query(...),
    limit: int = Query(default=200, ge=1, le=2000),
):
    """Get DIGIPIN locations within a bounding box — used by map viewport."""
    locs = generate_locations_in_bbox(lat_min, lat_max, lon_min, lon_max, max_results=limit)
    return {
        "locations": [_enrich_location(l) for l in locs],
        "total": len(locs),
        "bbox": {"lat_min": lat_min, "lat_max": lat_max, "lon_min": lon_min, "lon_max": lon_max},
    }


@router.get("/stats")
async def get_location_stats():
    """Get aggregate statistics about the location grid."""
    all_locs = _get_all_locations_cached()
    by_type: dict[str, int] = {}
    by_region: dict[str, int] = {}
    for loc in all_locs:
        wb = loc.get("water_body_type", "unknown")
        by_type[wb] = by_type.get(wb, 0) + 1
        reg = loc.get("region", "Unknown")
        by_region[reg] = by_region.get(reg, 0) + 1

    return {
        "total": len(all_locs),
        "total_locations": len(all_locs),
        "by_type": by_type,
        "by_region": dict(sorted(by_region.items(), key=lambda x: x[1], reverse=True)[:30]),
    }


@lru_cache(maxsize=1)
def _build_geojson() -> dict:
    """Build a GeoJSON FeatureCollection for map rendering.

    Ocean points are sampled (every 20th) to avoid visual clutter.
    Rivers, lakes, reservoirs are included at FULL density.
    """
    all_locs = _get_all_locations_cached()
    features = []
    ocean_counter = 0
    for loc in all_locs:
        wb = loc.get("water_body_type", "ocean")
        # Sample ocean points (111K → ~5.5K) to avoid solid blue mass
        if wb == "ocean":
            ocean_counter += 1
            if ocean_counter % 20 != 0:
                continue
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [loc["lon"], loc["lat"]],
            },
            "properties": {
                "n": loc["name"],
                "r": loc.get("region", ""),
                "t": wb,
            },
        })
    return {"type": "FeatureCollection", "features": features}


@router.get("/geojson")
async def get_locations_geojson():
    """Return ALL 95K+ locations as GeoJSON — for map rendering.

    Lightweight: no depth calculations, no shore distance.
    Uses cached GeoJSON built once on first call.
    """
    return _build_geojson()


@router.get("/detail/{digipin}")
async def get_location_detail(digipin: str):
    """Get full detail for any DIGIPIN location — works for any coordinate."""
    if not is_valid(digipin):
        raise HTTPException(status_code=400, detail="Invalid DIGIPIN")

    lat, lon, bbox = decode(digipin)
    wb_type = classify_water_body(lat, lon)

    # Try to match to a named location from the grid
    name = ""
    region = ""
    all_locs = _get_all_locations_cached()
    for loc in all_locs:
        if abs(loc["lat"] - lat) < 0.01 and abs(loc["lon"] - lon) < 0.01:
            name = loc["name"]
            region = loc.get("region", "")
            break

    if not name:
        # Generate a descriptive name based on location
        shore_dist = estimate_shore_distance(lat, lon)
        if wb_type == "ocean" and shore_dist < 50:
            name = f"Coastal Point ({lat:.2f}°N, {lon:.2f}°E)"
        elif wb_type == "ocean":
            name = f"Open Sea ({lat:.2f}°N, {lon:.2f}°E)"
        elif wb_type == "river":
            name = f"River Point ({lat:.2f}°N, {lon:.2f}°E)"
        else:
            name = f"Water Body ({lat:.2f}°N, {lon:.2f}°E)"

    return {
        "digipin": digipin.upper(),
        "latitude": lat,
        "longitude": lon,
        "bbox": bbox,
        "water_body_type": wb_type,
        "name": name,
        "region": region,
        "base_depth": estimate_base_depth(lat, lon, wb_type),
        "shore_distance_km": estimate_shore_distance(lat, lon),
    }

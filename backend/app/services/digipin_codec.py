"""
DIGIPIN Codec — Encode / Decode Indian geospatial grid codes.

Specification (India Post / IIT Hyderabad / NRSC-ISRO):
  - 10-character alphanumeric code
  - 16-character alphabet: 2 3 4 5 6 7 8 9 C F J K L M P T
  - Bounding box: 63.5°E–99.5°E, 2.5°N–38.5°N
  - Hierarchical 4×4 grid subdivided 10 levels → ~4 m × 4 m cell
  - CRS: EPSG:4326 (WGS 84)
"""

from __future__ import annotations

CHARSET = "23456789CFJKLMPT"

# Reverse lookup: character → index
_CHAR_TO_IDX: dict[str, int] = {c: i for i, c in enumerate(CHARSET)}

# India bounding box
LAT_MIN, LAT_MAX = 2.5, 38.5
LON_MIN, LON_MAX = 63.5, 99.5


def encode(lat: float, lon: float, precision: int = 10) -> str:
    """
    Encode a (latitude, longitude) pair into a DIGIPIN string.

    Parameters
    ----------
    lat : float — Latitude  (2.5 – 38.5)
    lon : float — Longitude (63.5 – 99.5)
    precision : int — Number of characters (default 10 ≈ 4 m)

    Returns
    -------
    str — DIGIPIN code (e.g. ``"F2JK8M35CL"``)

    Raises
    ------
    ValueError — If coordinates fall outside India's bounding box.
    """
    if not (LAT_MIN <= lat <= LAT_MAX):
        raise ValueError(f"Latitude {lat} outside range [{LAT_MIN}, {LAT_MAX}]")
    if not (LON_MIN <= lon <= LON_MAX):
        raise ValueError(f"Longitude {lon} outside range [{LON_MIN}, {LON_MAX}]")

    lat_lo, lat_hi = LAT_MIN, LAT_MAX
    lon_lo, lon_hi = LON_MIN, LON_MAX
    code: list[str] = []

    for _ in range(precision):
        lat_step = (lat_hi - lat_lo) / 4.0
        lon_step = (lon_hi - lon_lo) / 4.0

        # Row: 0 = northernmost, 3 = southernmost
        row = min(3, int((lat_hi - lat) / lat_step))
        # Col: 0 = westernmost, 3 = easternmost
        col = min(3, int((lon - lon_lo) / lon_step))

        code.append(CHARSET[row * 4 + col])

        # Narrow the bounding box
        lat_hi = lat_hi - row * lat_step
        lat_lo = lat_hi - lat_step
        lon_lo = lon_lo + col * lon_step
        lon_hi = lon_lo + lon_step

    return "".join(code)


def decode(digipin: str) -> tuple[float, float, dict]:
    """
    Decode a DIGIPIN string to its centre coordinates and bounding box.

    Parameters
    ----------
    digipin : str — DIGIPIN code (1–10 characters)

    Returns
    -------
    (lat, lon, bbox) where bbox = {"lat_min", "lat_max", "lon_min", "lon_max"}
    """
    digipin = digipin.upper().strip()
    for ch in digipin:
        if ch not in _CHAR_TO_IDX:
            raise ValueError(f"Invalid DIGIPIN character: '{ch}'")

    lat_lo, lat_hi = LAT_MIN, LAT_MAX
    lon_lo, lon_hi = LON_MIN, LON_MAX

    for ch in digipin:
        idx = _CHAR_TO_IDX[ch]
        row = idx // 4
        col = idx % 4

        lat_step = (lat_hi - lat_lo) / 4.0
        lon_step = (lon_hi - lon_lo) / 4.0

        lat_hi = lat_hi - row * lat_step
        lat_lo = lat_hi - lat_step
        lon_lo = lon_lo + col * lon_step
        lon_hi = lon_lo + lon_step

    centre_lat = (lat_lo + lat_hi) / 2.0
    centre_lon = (lon_lo + lon_hi) / 2.0
    bbox = {
        "lat_min": round(lat_lo, 8),
        "lat_max": round(lat_hi, 8),
        "lon_min": round(lon_lo, 8),
        "lon_max": round(lon_hi, 8),
    }
    return round(centre_lat, 8), round(centre_lon, 8), bbox


def is_valid(digipin: str) -> bool:
    """Check whether a string is a valid DIGIPIN code."""
    if not digipin or len(digipin) > 10:
        return False
    return all(ch in _CHAR_TO_IDX for ch in digipin.upper())


def digipin_for_request(
    digipin: str | None,
    latitude: float | None,
    longitude: float | None,
) -> tuple[str, float, float]:
    """
    Resolve a DIGIPIN from either a code or coordinates.
    Returns (digipin, lat, lon).
    """
    if digipin:
        lat, lon, _ = decode(digipin)
        return digipin, lat, lon
    if latitude is not None and longitude is not None:
        pin = encode(latitude, longitude)
        return pin, latitude, longitude
    raise ValueError("Provide either 'digipin' or both 'latitude' and 'longitude'.")

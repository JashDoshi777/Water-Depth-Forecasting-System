"""
Pydantic schemas for API request / response validation.
"""

from __future__ import annotations

import datetime as dt
from pydantic import BaseModel, Field


# ── DIGIPIN ──

class DigiPinEncodeRequest(BaseModel):
    latitude: float = Field(..., ge=2.5, le=38.5, description="Latitude (2.5–38.5°N)")
    longitude: float = Field(..., ge=63.5, le=99.5, description="Longitude (63.5–99.5°E)")

class DigiPinEncodeResponse(BaseModel):
    digipin: str
    latitude: float
    longitude: float
    bbox: dict

class DigiPinDecodeRequest(BaseModel):
    digipin: str = Field(..., min_length=1, max_length=10)

class DigiPinDecodeResponse(BaseModel):
    digipin: str
    latitude: float
    longitude: float
    bbox: dict


# ── Location ──

class LocationBase(BaseModel):
    digipin: str
    latitude: float
    longitude: float
    water_body_type: str = "ocean"
    name: str = ""
    region: str = ""

class LocationOut(LocationBase):
    id: int
    base_depth: float = 0.0
    shore_distance_km: float = 0.0

    class Config:
        from_attributes = True

class LocationSearchResult(BaseModel):
    locations: list[LocationOut]
    total: int


# ── Depth ──

class DepthCurrentRequest(BaseModel):
    digipin: str | None = None
    latitude: float | None = None
    longitude: float | None = None

class DepthCurrentResponse(BaseModel):
    digipin: str
    latitude: float
    longitude: float
    timestamp: str
    base_depth: float
    tidal_offset: float
    rainfall_impact: float
    discharge_delta: float
    computed_depth: float
    water_body_type: str = "ocean"
    confidence: float = 0.85

class DepthForecastRequest(BaseModel):
    digipin: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    hours_ahead: int = Field(default=48, ge=1, le=168)

class ForecastPoint(BaseModel):
    timestamp: str
    predicted_depth: float
    confidence_low: float
    confidence_high: float
    tidal_component: float
    rainfall_component: float

class DepthForecastResponse(BaseModel):
    digipin: str
    latitude: float
    longitude: float
    water_body_type: str
    forecast: list[ForecastPoint]
    model_version: str = "xgboost-v1"

class DepthHistoryResponse(BaseModel):
    digipin: str
    readings: list[dict]


# ── Weather ──

class WeatherResponse(BaseModel):
    digipin: str
    latitude: float
    longitude: float
    timestamp: str
    precipitation_mm: float
    temperature_c: float
    humidity_pct: float
    pressure_hpa: float
    wind_speed_ms: float
    precipitation_72h: float = 0.0
    monsoon_index: float = 0.0


# ── Marine / Tide ──

class TideResponse(BaseModel):
    digipin: str
    latitude: float
    longitude: float
    timestamp: str
    sea_level_m: float
    wave_height_m: float
    wave_direction_deg: float
    wave_period_s: float
    tide_phase: str = "unknown"


# ── Flood ──

class FloodRiskResponse(BaseModel):
    digipin: str
    latitude: float
    longitude: float
    timestamp: str
    risk_score: float
    alert_level: str
    discharge_m3s: float
    rainfall_deviation: float
    details: str


# ── Analytics ──

class AnalyticsOverview(BaseModel):
    total_locations: int
    coastal_locations: int
    inland_locations: int
    active_alerts: int
    avg_depth_m: float
    max_depth_m: float
    recent_readings: int
    data_freshness_minutes: float
    model_version: str

class LocationTypeCount(BaseModel):
    water_body_type: str
    count: int

class AlertSummary(BaseModel):
    alert_level: str
    count: int
    latest_timestamp: str | None = None

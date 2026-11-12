"""
SQLAlchemy ORM models for the Water Depth Forecasting System.
Designed for NeonDB (PostgreSQL) — no PostGIS extension required.
Geospatial calculations are handled in Python (pyproj / haversine).
"""

from __future__ import annotations

import datetime as dt
from sqlalchemy import (
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    func,
)
from app.database import Base


class Location(Base):
    """A DIGIPIN-indexed water body location."""

    __tablename__ = "locations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    digipin = Column(String(10), unique=True, nullable=False, index=True)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    water_body_type = Column(String(20), nullable=False)  # river, lake, ocean, reservoir
    name = Column(String(200), default="")
    region = Column(String(100), default="")
    base_depth = Column(Float, default=0.0)           # metres (from bathymetry)
    shore_distance_km = Column(Float, default=0.0)
    elevation_gradient = Column(Float, default=0.0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("ix_locations_coords", "latitude", "longitude"),
    )


class DepthReading(Base):
    """Time-series depth observation / computation."""

    __tablename__ = "depth_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    digipin = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False, index=True)
    base_depth = Column(Float, default=0.0)
    tidal_offset = Column(Float, default=0.0)
    rainfall_impact = Column(Float, default=0.0)
    discharge_delta = Column(Float, default=0.0)
    computed_depth = Column(Float, nullable=False)
    model_version = Column(String(50), default="physics-v1")

    __table_args__ = (
        Index("ix_depth_digipin_time", "digipin", "timestamp"),
    )


class WeatherReading(Base):
    """Hourly weather observation from Open-Meteo."""

    __tablename__ = "weather_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    digipin = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False)
    precipitation_mm = Column(Float, default=0.0)
    temperature_c = Column(Float, default=0.0)
    humidity_pct = Column(Float, default=0.0)
    pressure_hpa = Column(Float, default=0.0)
    wind_speed_ms = Column(Float, default=0.0)

    __table_args__ = (
        Index("ix_weather_digipin_time", "digipin", "timestamp"),
    )


class MarineReading(Base):
    """Hourly marine / tidal observation from Open-Meteo Marine."""

    __tablename__ = "marine_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    digipin = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False)
    sea_level_m = Column(Float, default=0.0)
    wave_height_m = Column(Float, default=0.0)
    wave_direction_deg = Column(Float, default=0.0)
    wave_period_s = Column(Float, default=0.0)

    __table_args__ = (
        Index("ix_marine_digipin_time", "digipin", "timestamp"),
    )


class FloodReading(Base):
    """River discharge data from Open-Meteo Flood API (GloFAS)."""

    __tablename__ = "flood_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    digipin = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, nullable=False)
    discharge_m3s = Column(Float, default=0.0)
    discharge_mean = Column(Float, default=0.0)
    discharge_max = Column(Float, default=0.0)
    discharge_min = Column(Float, default=0.0)

    __table_args__ = (
        Index("ix_flood_digipin_time", "digipin", "timestamp"),
    )


class FloodAlert(Base):
    """Flood / drought alert record."""

    __tablename__ = "flood_alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    digipin = Column(String(10), nullable=False, index=True)
    timestamp = Column(DateTime, server_default=func.now())
    risk_score = Column(Float, default=0.0)          # 0–1
    alert_level = Column(String(20), default="none")  # none, low, moderate, high, critical
    details = Column(Text, default="")
    location_name = Column(String(200), default="")
    latitude = Column(Float, default=0.0)
    longitude = Column(Float, default=0.0)

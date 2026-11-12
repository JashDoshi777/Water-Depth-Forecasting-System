"""API router — aggregates all v1 route modules."""

from fastapi import APIRouter
from app.api import digipin, depth, weather, locations, analytics, system, ml, bathymetry, mapdata, waterbodies, cyclones, forecastgrid, safety, validation

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(digipin.router)
api_router.include_router(depth.router)
api_router.include_router(weather.router)
api_router.include_router(locations.router)
api_router.include_router(analytics.router)
api_router.include_router(system.router)
api_router.include_router(ml.router)
api_router.include_router(bathymetry.router)
api_router.include_router(mapdata.router)
api_router.include_router(waterbodies.router)
api_router.include_router(cyclones.router)
api_router.include_router(forecastgrid.router)
api_router.include_router(safety.router)
api_router.include_router(validation.router)

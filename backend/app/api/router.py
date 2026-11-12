"""API router — aggregates all v1 route modules."""

from fastapi import APIRouter
from app.api import digipin, depth, weather, locations, analytics, system

api_router = APIRouter(prefix="/api/v1")

api_router.include_router(digipin.router)
api_router.include_router(depth.router)
api_router.include_router(weather.router)
api_router.include_router(locations.router)
api_router.include_router(analytics.router)
api_router.include_router(system.router)

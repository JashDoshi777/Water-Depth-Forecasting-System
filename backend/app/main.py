"""
Water Depth Forecasting System — FastAPI Application Entry Point.

Serves the REST API and the React frontend static build.
Designed for HuggingFace Spaces Docker deployment (port 7860).
"""

from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.config import get_settings
from app.api.router import api_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle hooks."""
    # ── Startup ──
    print("Starting Water Depth Forecasting System...")
    async def _init_db_bg():
        # Remote Postgres can take many seconds to wake up; don't block startup.
        try:
            from app.database import init_db
            await asyncio.wait_for(init_db(), timeout=60)
            print("Database tables initialised.")
        except Exception as e:
            print(f"Database init skipped (non-fatal): {e}")

    db_task = asyncio.create_task(_init_db_bg())

    async def _warm_cache():
        # Pre-compute the alert scan so the first Alerts/Analytics visit is instant.
        try:
            from app.api.analytics import _compute_alerts
            await _compute_alerts()
        except Exception as e:
            print(f"Cache warm-up skipped: {e}")

    warm_task = asyncio.create_task(_warm_cache())

    yield

    db_task.cancel()
    warm_task.cancel()

    # ── Shutdown ──
    try:
        from app.database import close_db
        await close_db()
    except Exception:
        pass
    print("Shutdown complete.")


app = FastAPI(
    title="Water Depth Forecasting System",
    description="Predict real-time water depth at any DIGIPIN location in Indian water bodies.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── API Routes ──
app.include_router(api_router)


# ── Health check ──
@app.get("/api/health")
async def health():
    return {"status": "healthy", "service": "water-depth-forecast", "version": "1.0.0"}


# ── Serve React build (production) ──
_FRONTEND_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"

if _FRONTEND_DIR.is_dir():
    # Serve static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=_FRONTEND_DIR / "assets"), name="assets")

    # Serve other static files at root level
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        """SPA fallback — serve index.html for all non-API routes."""
        file_path = _FRONTEND_DIR / full_path
        if file_path.is_file():
            return FileResponse(file_path)
        return FileResponse(_FRONTEND_DIR / "index.html")
else:
    @app.get("/")
    async def root():
        return {
            "message": "Water Depth Forecasting API",
            "docs": "/api/docs",
            "note": "Frontend not built — run 'cd frontend && npm run build'",
        }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=settings.app_port,
        reload=(not settings.is_production),
    )

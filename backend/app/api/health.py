"""Health endpoints. These are the only unauthenticated routes."""

from __future__ import annotations

from fastapi import APIRouter, Response, status

from app import __version__
from app.core.config import get_settings
from app.core.db import ping_db

router = APIRouter(tags=["health"])


@router.get("/health", summary="Liveness")
async def health() -> dict:
    settings = get_settings()
    return {
        "status": "ok",
        "app": settings.app_name,
        "version": __version__,
        "llm_enabled": settings.llm_enabled,
        "data_notice": "synthetic data",
    }


@router.get("/health/db", summary="Database reachable")
async def health_db(response: Response) -> dict:
    reachable = await ping_db()
    if not reachable:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"database": "ok" if reachable else "unavailable"}

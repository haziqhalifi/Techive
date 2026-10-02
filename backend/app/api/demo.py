"""Demo helpers. Synthetic only — these exist so the console has something to run."""

from __future__ import annotations

from fastapi import APIRouter

from app.models.case import CaseCreate
from app.services.case_service import HERO_CASE

router = APIRouter(prefix="/demo", tags=["demo"])


@router.get(
    "/hero-case",
    response_model=CaseCreate,
    summary="The pre-filled hero case (synthetic)",
)
async def hero_case() -> CaseCreate:
    """Level 23 'too hot' complaint while the chiller plant drifts 0.62 -> 0.71 kW/RT."""
    return CaseCreate(**HERO_CASE)

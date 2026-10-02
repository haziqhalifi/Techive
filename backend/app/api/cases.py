"""Case endpoints: run the pipeline and read the resulting decision card."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, get_user_id
from app.core.security import ANY_ROLE, CAN_RUN_CASES
from app.models.case import CaseCreate, CaseListResponse, DecisionCard
from app.models.enums import Role
from app.services import case_service

router = APIRouter(prefix="/cases", tags=["cases"])


@router.post("", response_model=DecisionCard, summary="Run a case through the pipeline")
async def create_case(
    body: CaseCreate,
    session: AsyncSession = Depends(get_session),
    role: Role = Depends(CAN_RUN_CASES),
    actor_id: str | None = Depends(get_user_id),
) -> DecisionCard:
    return await case_service.create_case(session, body, actor_id=actor_id, actor_role=role)


@router.get("", response_model=CaseListResponse, summary="List recent cases")
async def list_cases(
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_session),
    _role: Role = Depends(ANY_ROLE),
) -> CaseListResponse:
    cases = await case_service.list_cases(session, limit=limit)
    return CaseListResponse(count=len(cases), cases=cases)


@router.get("/{case_id}", response_model=DecisionCard, summary="Decision card for a case")
async def get_case(
    case_id: str,
    session: AsyncSession = Depends(get_session),
    _role: Role = Depends(ANY_ROLE),
) -> DecisionCard:
    return await case_service.get_case_card(session, case_id)

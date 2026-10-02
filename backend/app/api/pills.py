"""Pill endpoints: browse approved pills and run the review lifecycle."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session, get_user_id
from app.core.security import ANY_ROLE, CAN_APPROVE
from app.models.enums import PillDomain, PillStatus, Role
from app.models.pill import (
    PillDetail,
    PillListResponse,
    ReviewRequest,
    RollbackRequest,
)
from app.services import pill_service

router = APIRouter(prefix="/pills", tags=["pills"])


@router.get("", response_model=PillListResponse, summary="List pills")
async def list_pills(
    status: PillStatus | None = Query(default=None),
    domain: PillDomain | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    _role: Role = Depends(ANY_ROLE),
) -> PillListResponse:
    pills = await pill_service.list_pills(session, status=status, domain=domain)
    return PillListResponse(count=len(pills), pills=pills)


@router.get(
    "/{pill_id}", response_model=PillDetail, summary="Pill detail with versions and evidence"
)
async def get_pill(
    pill_id: str,
    session: AsyncSession = Depends(get_session),
    _role: Role = Depends(ANY_ROLE),
) -> PillDetail:
    return await pill_service.get_detail(session, pill_id)


@router.post("/{pill_id}/approve", response_model=PillDetail, summary="Approve a version (FR-03)")
async def approve_pill(
    pill_id: str,
    body: ReviewRequest,
    session: AsyncSession = Depends(get_session),
    role: Role = Depends(CAN_APPROVE),
    actor_id: str | None = Depends(get_user_id),
) -> PillDetail:
    return await pill_service.approve(
        session,
        pill_id,
        note=body.note,
        version=body.version,
        actor_id=actor_id,
        actor_role=role,
    )


@router.post("/{pill_id}/reject", response_model=PillDetail, summary="Reject a version (FR-03)")
async def reject_pill(
    pill_id: str,
    body: ReviewRequest,
    session: AsyncSession = Depends(get_session),
    role: Role = Depends(CAN_APPROVE),
    actor_id: str | None = Depends(get_user_id),
) -> PillDetail:
    return await pill_service.reject(
        session,
        pill_id,
        note=body.note,
        version=body.version,
        actor_id=actor_id,
        actor_role=role,
    )


@router.post("/{pill_id}/rollback", response_model=PillDetail, summary="Roll back (FR-10)")
async def rollback_pill(
    pill_id: str,
    body: RollbackRequest,
    session: AsyncSession = Depends(get_session),
    role: Role = Depends(CAN_APPROVE),
    actor_id: str | None = Depends(get_user_id),
) -> PillDetail:
    return await pill_service.rollback(
        session,
        pill_id,
        target_version=body.target_version,
        note=body.note,
        actor_id=actor_id,
        actor_role=role,
    )

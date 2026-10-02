"""Audit endpoints (FR-11). Read-only, append-only."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_session
from app.core.security import CAN_READ_AUDIT
from app.models.audit import AuditEntry, AuditListResponse
from app.models.enums import Role
from app.services import audit_service

router = APIRouter(prefix="/audit", tags=["audit"])


@router.get("", response_model=AuditListResponse, summary="Read the hash-chained audit trail")
async def list_audit(
    limit: int = Query(default=200, ge=1, le=1000),
    entity_type: str | None = Query(default=None),
    entity_id: str | None = Query(default=None),
    session: AsyncSession = Depends(get_session),
    _role: Role = Depends(CAN_READ_AUDIT),
) -> AuditListResponse:
    entries = await audit_service.list_entries(
        session, limit=limit, entity_type=entity_type, entity_id=entity_id
    )
    valid, broken_at, _count = await audit_service.verify(session)

    return AuditListResponse(
        count=len(entries),
        chain_valid=valid,
        broken_at_seq=broken_at,
        entries=[AuditEntry(**entry) for entry in entries],
    )

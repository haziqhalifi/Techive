"""Audit models (FR-11): append-only, hash-chained."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from app.models.common import ApiModel
from app.models.enums import AuditAction, Role


class AuditEntry(ApiModel):
    seq: int
    occurred_at: datetime
    actor_id: str | None = None
    actor_role: Role | None = None
    action: AuditAction
    entity_type: str
    entity_id: str
    payload: dict[str, Any]
    prev_hash: str
    hash: str


class AuditListResponse(ApiModel):
    count: int
    chain_valid: bool
    broken_at_seq: int | None = None
    entries: list[AuditEntry]

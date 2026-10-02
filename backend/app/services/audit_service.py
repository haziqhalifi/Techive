"""FR-11 — append-only, hash-chained audit trail.

Each entry commits to the one before it:

    hash = sha256(prev_hash + canonical_json(action, entity_type, entity_id,
                                             payload, occurred_at))

The genesis entry uses 64 zeros as `prev_hash`. The database additionally refuses UPDATE
and DELETE on `audit_logs` (see data/schema.sql), so tampering is detectable and mutation
is blocked at both layers.

The chain maths is pure and unit-tested without a database.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.jsonutil import loads_if_str
from app.models.audit import AuditEntry
from app.models.enums import AuditAction, Role

GENESIS_HASH = "0" * 64
HASHED_FIELDS = ("action", "entity_type", "entity_id", "payload", "occurred_at")
_ADVISORY_LOCK_KEY = "harvest_audit_chain"


# ---------------------------------------------------------------- pure chain maths
def _default(value: Any) -> str:
    if isinstance(value, datetime):
        return iso(value)
    if isinstance(value, Role):
        return value.value
    return str(value)


def iso(value: datetime | str) -> str:
    """Canonical UTC timestamp with microsecond precision (round-trips through Postgres).

    Accepts an already-canonical string so the same function serves both freshly built
    entries and rows read back from the database.
    """
    if isinstance(value, str):
        return value
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(UTC).isoformat(timespec="microseconds")


def canonical_json(fields: Mapping[str, Any]) -> str:
    return json.dumps(fields, sort_keys=True, separators=(",", ":"), default=_default)


def entry_fields(
    *,
    action: AuditAction | str,
    entity_type: str,
    entity_id: str,
    payload: Mapping[str, Any] | None,
    occurred_at: datetime,
) -> dict[str, Any]:
    """The exact subset of an entry that the hash commits to."""
    return {
        "action": action.value if isinstance(action, AuditAction) else str(action),
        "entity_type": entity_type,
        "entity_id": entity_id,
        "payload": dict(payload or {}),
        "occurred_at": iso(occurred_at),
    }


def chain_hash(prev_hash: str, fields: Mapping[str, Any]) -> str:
    body = canonical_json(fields)
    return hashlib.sha256((prev_hash + body).encode("utf-8")).hexdigest()


def verify_chain(entries: Sequence[Mapping[str, Any]]) -> tuple[bool, int | None]:
    """Verify a sequence of entries in ascending seq order.

    Returns (valid, broken_at_seq). Pure — takes plain mappings, not ORM rows.
    """
    prev = GENESIS_HASH
    for index, entry in enumerate(entries):
        fields = entry_fields(
            action=entry["action"],
            entity_type=entry["entity_type"],
            entity_id=entry["entity_id"],
            payload=entry.get("payload") or {},
            occurred_at=entry["occurred_at"],
        )
        expected = chain_hash(prev, fields)
        if entry["hash"] != expected:
            return False, int(entry.get("seq", index))
        prev = entry["hash"]
    return True, None


# ---------------------------------------------------------------- persistence
async def _last_hash(session: AsyncSession) -> str:
    result = await session.execute(text("SELECT hash FROM audit_logs ORDER BY seq DESC LIMIT 1"))
    row = result.first()
    return row[0] if row else GENESIS_HASH


async def append(
    session: AsyncSession,
    *,
    action: AuditAction,
    entity_type: str,
    entity_id: str,
    payload: Mapping[str, Any] | None = None,
    actor_id: str | None = None,
    actor_role: Role | None = None,
    occurred_at: datetime | None = None,
) -> AuditEntry:
    """Append one entry, extending the hash chain. Serialised via an advisory lock."""
    occurred = occurred_at or datetime.now(UTC)

    # Serialise concurrent appends so two writers cannot fork the chain.
    await session.execute(
        text("SELECT pg_advisory_xact_lock(hashtext(:key))"), {"key": _ADVISORY_LOCK_KEY}
    )
    prev_hash = await _last_hash(session)

    fields = entry_fields(
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload,
        occurred_at=occurred,
    )
    digest = chain_hash(prev_hash, fields)

    result = await session.execute(
        text("""
            INSERT INTO audit_logs
                (occurred_at, actor_id, actor_role, action, entity_type, entity_id,
                 payload, prev_hash, hash)
            VALUES
                (:occurred_at, :actor_id, CAST(:actor_role AS role_name),
                 CAST(:action AS audit_action), :entity_type, :entity_id,
                 CAST(:payload AS jsonb), :prev_hash, :hash)
            RETURNING seq
            """),
        {
            "occurred_at": occurred,
            "actor_id": actor_id,
            "actor_role": actor_role.value if actor_role else None,
            "action": action.value,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "payload": json.dumps(dict(payload or {}), default=_default),
            "prev_hash": prev_hash,
            "hash": digest,
        },
    )
    seq = result.scalar_one()
    await session.commit()

    return AuditEntry(
        seq=seq,
        occurred_at=occurred,
        actor_id=actor_id,
        actor_role=actor_role,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=dict(payload or {}),
        prev_hash=prev_hash,
        hash=digest,
    )


async def list_entries(
    session: AsyncSession,
    *,
    limit: int = 200,
    entity_type: str | None = None,
    entity_id: str | None = None,
) -> list[dict[str, Any]]:
    clauses, params = [], {"limit": limit}
    if entity_type:
        clauses.append("entity_type = :entity_type")
        params["entity_type"] = entity_type
    if entity_id:
        clauses.append("entity_id = :entity_id")
        params["entity_id"] = entity_id
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    result = await session.execute(
        text(f"""
            SELECT seq, occurred_at, actor_id, actor_role, action, entity_type,
                   entity_id, payload, prev_hash, hash
            FROM audit_logs
            {where}
            ORDER BY seq ASC
            LIMIT :limit
            """),
        params,
    )
    entries: list[dict[str, Any]] = []
    for row in result:
        entry = dict(row._mapping)
        entry["payload"] = loads_if_str(entry.get("payload"), default={})
        entries.append(entry)
    return entries


async def verify(session: AsyncSession) -> tuple[bool, int | None, int]:
    """Verify the whole chain. Returns (valid, broken_at_seq, count)."""
    entries = await list_entries(session, limit=100_000)
    valid, broken = verify_chain(entries)
    return valid, broken, len(entries)

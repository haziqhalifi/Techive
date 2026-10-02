"""Pill lifecycle: draft -> in_review -> approved -> superseded/rolled_back (FR-02, FR-03, FR-10).

Claim validation is pure and unit-tested without a database. The rest is explicit SQL over
the hand-written schema.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import NotFound, ValidationFailure
from app.core.jsonutil import as_dict, as_list
from app.models.enums import AuditAction, ClaimKind, EvalStatus, PillDomain, PillStatus, Role
from app.models.pill import (
    Claim,
    PillDetail,
    PillOption,
    PillSummary,
    PillVersion,
)
from app.models.transcript import TranscriptExcerpt
from app.services import audit_service


# ---------------------------------------------------------------- pure validation (FR-02)
def validate_claims(claims: Sequence[Claim]) -> None:
    """Reject any non-unknown claim that does not cite a real source excerpt.

    This is the rule that stops the system inventing guidance. The database enforces the
    same constraint (data/schema.sql), so it holds even if a write bypasses this service.
    """
    offenders = [
        claim
        for claim in claims
        if claim.kind is not ClaimKind.UNKNOWN and not claim.source_excerpt_id
    ]
    if offenders:
        raise ValidationFailure(
            "Every non-unknown claim must cite a source excerpt (FR-02).",
            {"offending_claims": [claim.text for claim in offenders]},
        )


def assert_author_cannot_approve(pill_owner_id: str | None, actor_id: str | None) -> None:
    """FR-03: authors never approve their own pills."""
    if pill_owner_id and actor_id and str(pill_owner_id) == str(actor_id):
        raise ValidationFailure(
            "An author cannot approve their own pill (FR-03).",
            {"owner_id": str(pill_owner_id)},
        )


# ---------------------------------------------------------------- row helpers
_PILL_COLUMNS = (
    "id, domain, layer, title, status, current_version, owner_id, reviewer_id, access_class"
)


async def _fetch_pill_row(session: AsyncSession, pill_id: str) -> dict[str, Any] | None:
    result = await session.execute(
        text(f"SELECT {_PILL_COLUMNS} FROM pills WHERE id = :pill_id"), {"pill_id": pill_id}
    )
    row = result.first()
    return dict(row._mapping) if row else None


async def _fetch_version_rows(session: AsyncSession, pill_id: str) -> list[dict[str, Any]]:
    result = await session.execute(
        text("""
            SELECT pill_id, version, status, context, triggers, critical_cues,
                   discounted_signals, decision_logic, never_do, trade_offs, escalation,
                   governance, eval_status, eval_score
            FROM pill_versions
            WHERE pill_id = :pill_id
            ORDER BY version ASC
            """),
        {"pill_id": pill_id},
    )
    return [dict(row._mapping) for row in result]


async def _fetch_claims(session: AsyncSession, pill_id: str) -> list[dict[str, Any]]:
    result = await session.execute(
        text("""
            SELECT version, kind, text, source_excerpt_id, confidence
            FROM claims
            WHERE pill_id = :pill_id
            ORDER BY version ASC, kind ASC
            """),
        {"pill_id": pill_id},
    )
    return [dict(row._mapping) for row in result]


async def _fetch_options(session: AsyncSession, pill_id: str) -> list[dict[str, Any]]:
    result = await session.execute(
        text("""
            SELECT id, version, label, tier, detail, expected_kwh_delta, comfort_impact,
                   source_excerpt_id
            FROM pill_options
            WHERE pill_id = :pill_id
            ORDER BY version ASC, id ASC
            """),
        {"pill_id": pill_id},
    )
    return [dict(row._mapping) for row in result]


async def _fetch_excerpts(
    session: AsyncSession, excerpt_ids: set[str]
) -> dict[str, TranscriptExcerpt]:
    if not excerpt_ids:
        return {}
    result = await session.execute(
        text("""
            SELECT id, interview_id, speaker, occurred_at, text
            FROM transcript_excerpts
            WHERE id = ANY(:ids)
            """),
        {"ids": list(excerpt_ids)},
    )
    return {row.id: TranscriptExcerpt(**dict(row._mapping)) for row in result}


# ---------------------------------------------------------------- assembly
def _build_version(
    row: dict[str, Any],
    claims_by_version: dict[int, list[dict[str, Any]]],
    options_by_version: dict[int, list[dict[str, Any]]],
) -> PillVersion:
    version = int(row["version"])
    return PillVersion(
        version=version,
        status=PillStatus(row["status"]),
        eval_status=EvalStatus(row["eval_status"]),
        eval_score=float(row["eval_score"]) if row["eval_score"] is not None else None,
        context=as_dict(row["context"]),
        triggers=as_list(row["triggers"]),
        critical_cues=as_list(row["critical_cues"]),
        discounted_signals=as_list(row["discounted_signals"]),
        decision_logic=as_dict(row["decision_logic"]),
        never_do=as_list(row["never_do"]),
        trade_offs=as_dict(row["trade_offs"]),
        escalation=as_dict(row["escalation"]),
        governance=as_dict(row["governance"]),
        claims=[
            Claim(
                kind=ClaimKind(c["kind"]),
                text=c["text"],
                source_excerpt_id=c["source_excerpt_id"],
                confidence=float(c["confidence"]) if c["confidence"] is not None else None,
            )
            for c in claims_by_version.get(version, [])
        ],
        options=[
            PillOption(
                id=o["id"],
                tier=o["tier"],
                label=o["label"],
                detail=o["detail"],
                expected_kwh_delta=(
                    float(o["expected_kwh_delta"]) if o["expected_kwh_delta"] is not None else None
                ),
                comfort_impact=o["comfort_impact"],
                source_excerpt_id=o["source_excerpt_id"],
            )
            for o in options_by_version.get(version, [])
        ],
    )


async def get_detail(session: AsyncSession, pill_id: str) -> PillDetail:
    pill = await _fetch_pill_row(session, pill_id)
    if pill is None:
        raise NotFound("Pill", pill_id)

    version_rows = await _fetch_version_rows(session, pill_id)
    claim_rows = await _fetch_claims(session, pill_id)
    option_rows = await _fetch_options(session, pill_id)

    claims_by_version: dict[int, list[dict[str, Any]]] = {}
    for claim in claim_rows:
        claims_by_version.setdefault(int(claim["version"]), []).append(claim)

    options_by_version: dict[int, list[dict[str, Any]]] = {}
    for option in option_rows:
        options_by_version.setdefault(int(option["version"]), []).append(option)

    versions = [_build_version(r, claims_by_version, options_by_version) for r in version_rows]
    live = next((v for v in versions if v.version == int(pill["current_version"])), None)

    # Evidence covers both claims and options, so the card can always show provenance.
    excerpt_ids = {c["source_excerpt_id"] for c in claim_rows if c["source_excerpt_id"]}
    excerpt_ids |= {o["source_excerpt_id"] for o in option_rows if o["source_excerpt_id"]}
    excerpts = await _fetch_excerpts(session, excerpt_ids)

    return PillDetail(
        **pill,
        context=live.context if live else None,
        triggers=live.triggers if live else [],
        critical_cues=live.critical_cues if live else [],
        discounted_signals=live.discounted_signals if live else [],
        never_do=live.never_do if live else [],
        trade_offs=live.trade_offs if live else {},
        escalation=live.escalation if live else {},
        decision_logic=live.decision_logic if live else {},
        versions=versions,
        evidence=sorted(excerpts.values(), key=lambda e: e.id),
    )


async def list_pills(
    session: AsyncSession,
    *,
    status: PillStatus | None = None,
    domain: PillDomain | None = None,
) -> list[PillSummary]:
    clauses, params = [], {}
    if status is not None:
        clauses.append("status = CAST(:status AS pill_status)")
        params["status"] = status.value
    if domain is not None:
        clauses.append("domain = CAST(:domain AS pill_domain)")
        params["domain"] = domain.value
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    result = await session.execute(
        text(f"SELECT {_PILL_COLUMNS} FROM pills {where} ORDER BY id ASC"), params
    )
    return [PillSummary(**dict(row._mapping)) for row in result]


async def list_approved(session: AsyncSession) -> list[PillSummary]:
    """Only approved pills may ever reach the agents (FR-05)."""
    return await list_pills(session, status=PillStatus.APPROVED)


# ---------------------------------------------------------------- lifecycle (FR-03 / FR-10)
async def approve(
    session: AsyncSession,
    pill_id: str,
    *,
    note: str,
    actor_id: str | None,
    actor_role: Role | None,
    version: int | None = None,
) -> PillDetail:
    pill = await _fetch_pill_row(session, pill_id)
    if pill is None:
        raise NotFound("Pill", pill_id)

    version_rows = await _fetch_version_rows(session, pill_id)
    if not version_rows:
        raise NotFound("Pill version", f"{pill_id} (no versions)")

    target = version if version is not None else max(int(r["version"]) for r in version_rows)
    row = next((r for r in version_rows if int(r["version"]) == target), None)
    if row is None:
        raise NotFound("Pill version", f"{pill_id} v{target}")

    assert_author_cannot_approve(pill["owner_id"], actor_id)

    # FR-10: a version that has not passed its eval run may never be approved.
    if str(row["eval_status"]) != EvalStatus.PASSED.value:
        raise ValidationFailure(
            f"Version {target} has not passed its eval run and cannot be approved (FR-10).",
            {"pill_id": pill_id, "version": target, "eval_status": str(row["eval_status"])},
        )

    await session.execute(
        text("""
            UPDATE pill_versions SET status = CAST('superseded' AS pill_status)
            WHERE pill_id = :pill_id AND version <> :target
              AND status = CAST('approved' AS pill_status)
            """),
        {"pill_id": pill_id, "target": target},
    )
    await session.execute(
        text("""
            UPDATE pill_versions SET status = CAST('approved' AS pill_status)
            WHERE pill_id = :pill_id AND version = :target
            """),
        {"pill_id": pill_id, "target": target},
    )
    await session.execute(
        text("""
            UPDATE pills
            SET status = CAST('approved' AS pill_status),
                current_version = :target,
                reviewer_id = CAST(:reviewer_id AS uuid),
                updated_at = now()
            WHERE id = :pill_id
            """),
        {"pill_id": pill_id, "target": target, "reviewer_id": actor_id},
    )

    await audit_service.append(
        session,
        action=AuditAction.APPROVE,
        entity_type="pill",
        entity_id=pill_id,
        payload={"version": target, "note": note},
        actor_id=actor_id,
        actor_role=actor_role,
    )
    return await get_detail(session, pill_id)


async def reject(
    session: AsyncSession,
    pill_id: str,
    *,
    note: str,
    actor_id: str | None,
    actor_role: Role | None,
    version: int | None = None,
) -> PillDetail:
    """Send a draft back to its author. Recorded with the reviewer's note."""
    version_rows = await _fetch_version_rows(session, pill_id)
    if not version_rows:
        raise NotFound("Pill", pill_id)
    target = version if version is not None else max(int(r["version"]) for r in version_rows)

    await session.execute(
        text("""
            UPDATE pill_versions SET status = CAST('draft' AS pill_status)
            WHERE pill_id = :pill_id AND version = :target
            """),
        {"pill_id": pill_id, "target": target},
    )
    await audit_service.append(
        session,
        action=AuditAction.REJECT,
        entity_type="pill",
        entity_id=pill_id,
        payload={"version": target, "note": note},
        actor_id=actor_id,
        actor_role=actor_role,
    )
    return await get_detail(session, pill_id)


async def rollback(
    session: AsyncSession,
    pill_id: str,
    *,
    target_version: int,
    note: str,
    actor_id: str | None,
    actor_role: Role | None,
) -> PillDetail:
    """FR-10: restore a superseded version and log the rollback."""
    pill = await _fetch_pill_row(session, pill_id)
    if pill is None:
        raise NotFound("Pill", pill_id)

    version_rows = await _fetch_version_rows(session, pill_id)
    row = next((r for r in version_rows if int(r["version"]) == target_version), None)
    if row is None:
        raise NotFound("Pill version", f"{pill_id} v{target_version}")

    previous = int(pill["current_version"])

    await session.execute(
        text("""
            UPDATE pill_versions SET status = CAST('superseded' AS pill_status)
            WHERE pill_id = :pill_id AND version <> :target
              AND status = CAST('approved' AS pill_status)
            """),
        {"pill_id": pill_id, "target": target_version},
    )
    await session.execute(
        text("""
            UPDATE pill_versions SET status = CAST('approved' AS pill_status)
            WHERE pill_id = :pill_id AND version = :target
            """),
        {"pill_id": pill_id, "target": target_version},
    )
    await session.execute(
        text("""
            UPDATE pills
            SET status = CAST('approved' AS pill_status),
                current_version = :target,
                updated_at = now()
            WHERE id = :pill_id
            """),
        {"pill_id": pill_id, "target": target_version},
    )

    await audit_service.append(
        session,
        action=AuditAction.ROLLBACK,
        entity_type="pill",
        entity_id=pill_id,
        payload={"from_version": previous, "to_version": target_version, "note": note},
        actor_id=actor_id,
        actor_role=actor_role,
    )
    return await get_detail(session, pill_id)

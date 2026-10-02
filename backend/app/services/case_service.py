"""Case orchestration (FR-05, FR-06, FR-07).

Loads the approved candidate pills, runs the LangGraph pipeline, persists the case and its
decision options, and writes an audit entry. The graph itself stays database-free; this
service is the only place that touches both the DB and the graph.
"""

from __future__ import annotations

import json
import uuid
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.graph import run_case
from app.core.errors import HarvestError, NotFound
from app.core.jsonutil import loads_if_str
from app.models.case import (
    CaseCreate,
    CaseRecord,
    ContextCheckResult,
    DecisionCard,
    DecisionOption,
    GateResult,
    Metrics,
)
from app.models.enums import AuditAction, Route
from app.services import audit_service, pill_service

# The hero case, used by the console's "Run hero case" button.
# All values are synthetic; the readings match data/raw/chiller_timeseries.csv.
HERO_CASE: dict[str, Any] = {
    "site_id": "SGT-01",
    "asset_type": "office",
    "chiller_plant": "water_cooled_3x",
    "tariff": "SG_commercial",
    "tenant_id": "L23-ACME",
    "level": 23,
    "reported_at": "2026-10-02T14:40:00+08:00",
    "complaint_text": "Level 23 ACME — it's too hot in our meeting rooms this afternoon.",
    "baseline_kwrt": 0.62,
    "current_kwrt": 0.71,
    "load_rt": 850.0,
    "wet_bulb_c": 33.1,
}


# ---------------------------------------------------------------- candidate loading (FR-05)
async def list_candidates(session: AsyncSession) -> list[dict[str, Any]]:
    """Approved pills, shaped for the graph. Only approved pills ever reach the agents."""
    candidates: list[dict[str, Any]] = []

    for summary in await pill_service.list_approved(session):
        detail = await pill_service.get_detail(session, summary.id)
        live = next((v for v in detail.versions if v.version == detail.current_version), None)
        if live is None:
            continue

        excerpt_text = {excerpt.id: excerpt.text for excerpt in detail.evidence}
        candidates.append(
            {
                "id": detail.id,
                "title": detail.title,
                "domain": detail.domain.value,
                "version": live.version,
                "context": live.context.model_dump() if live.context else {},
                "triggers": live.triggers,
                "never_do": live.never_do,
                "decision_logic": live.decision_logic,
                "trade_offs": live.trade_offs,
                "options": [
                    {
                        "id": option.id,
                        "tier": option.tier.value,
                        "label": option.label,
                        "detail": option.detail,
                        "comfort_impact": option.comfort_impact,
                        "source_excerpt_id": option.source_excerpt_id,
                        "source_excerpt": excerpt_text.get(option.source_excerpt_id or ""),
                    }
                    for option in live.options
                ],
            }
        )

    return candidates


async def _load_tenant(session: AsyncSession, tenant_id: str | None) -> dict[str, Any] | None:
    if not tenant_id:
        return None
    result = await session.execute(
        text("SELECT id, name, level, renewal_due FROM tenants WHERE id = :tenant_id"),
        {"tenant_id": tenant_id},
    )
    row = result.first()
    if row is None:
        return None
    tenant = dict(row._mapping)
    if tenant.get("renewal_due") is not None:
        tenant["renewal_due"] = tenant["renewal_due"].isoformat()
    return tenant


# ---------------------------------------------------------------- persistence
async def _insert_case(
    session: AsyncSession,
    case_id: str,
    payload: CaseCreate,
    state: dict[str, Any],
    created_by: str | None,
) -> None:
    await session.execute(
        text("""
            INSERT INTO cases
                (id, site_id, asset_type, chiller_plant, tariff, tenant_id, level,
                 reported_at, complaint_text, signals, status, gate, context_check,
                 metrics, created_by)
            VALUES
                (CAST(:id AS uuid), :site_id, :asset_type, :chiller_plant, :tariff,
                 :tenant_id, :level, :reported_at, :complaint_text,
                 CAST(:signals AS jsonb), CAST(:status AS case_status),
                 CAST(:gate AS jsonb), CAST(:context_check AS jsonb),
                 CAST(:metrics AS jsonb), CAST(:created_by AS uuid))
            """),
        {
            "id": case_id,
            "site_id": payload.site_id,
            "asset_type": payload.asset_type,
            "chiller_plant": payload.chiller_plant,
            "tariff": payload.tariff,
            "tenant_id": payload.tenant_id,
            "level": payload.level,
            "reported_at": payload.reported_at,
            "complaint_text": payload.complaint_text,
            "signals": json.dumps(state.get("signals") or {}),
            "status": (state.get("card") or {}).get("status", "open"),
            "gate": json.dumps(state.get("gate") or {}),
            "context_check": json.dumps(state.get("context_check") or {}),
            "metrics": json.dumps(state.get("metrics") or {}),
            "created_by": created_by,
        },
    )


async def _insert_options(
    session: AsyncSession, case_id: str, options: list[dict[str, Any]]
) -> None:
    for option in options:
        await session.execute(
            text("""
                INSERT INTO decision_options
                    (case_id, pill_id, pill_version, option_id, label, detail, tier,
                     kwh_delta, sgd_delta, comfort_impact, renewal_flag, conflict,
                     source_excerpt_id)
                VALUES
                    (CAST(:case_id AS uuid), :pill_id, :pill_version, :option_id, :label,
                     :detail, CAST(:tier AS action_tier), :kwh_delta, :sgd_delta,
                     :comfort_impact, :renewal_flag, :conflict, :source_excerpt_id)
                """),
            {
                "case_id": case_id,
                "pill_id": option.get("pill_id"),
                "pill_version": option.get("pill_version"),
                "option_id": option.get("option_id"),
                "label": option.get("label"),
                "detail": option.get("detail"),
                "tier": option.get("tier"),
                "kwh_delta": option.get("kwh_delta"),
                "sgd_delta": option.get("sgd_delta"),
                "comfort_impact": option.get("comfort_impact"),
                "renewal_flag": bool(option.get("renewal_flag")),
                "conflict": option.get("conflict"),
                "source_excerpt_id": option.get("source_excerpt_id"),
            },
        )


def _audit_action_for(state: dict[str, Any]) -> AuditAction:
    card = state.get("card") or {}
    route = state.get("route")
    if route == Route.ESCALATE.value and (state.get("gate") or {}).get("escalate"):
        return AuditAction.GATE_ESCALATE
    if route == Route.BLOCKED.value:
        return AuditAction.CONTEXT_BLOCK
    if card.get("options"):
        return AuditAction.APPLY
    return AuditAction.VIEW


# ---------------------------------------------------------------- public API
async def create_case(
    session: AsyncSession,
    payload: CaseCreate,
    *,
    actor_id: str | None,
    actor_role: Any,
) -> DecisionCard:
    """Run the pipeline for a new complaint and persist the outcome."""
    case_id = str(uuid.uuid4())

    candidates = await list_candidates(session)
    tenant = await _load_tenant(session, payload.tenant_id)

    state = await run_case(
        {
            "case_id": case_id,
            "case": payload.model_dump(mode="json"),
            "candidates": candidates,
            "tenant": tenant,
            "audit_refs": [],
        }
    )

    if state.get("error"):
        raise HarvestError(
            "pipeline_error",
            f"The decision pipeline failed: {state['error']}",
            status_code=500,
        )

    card = state.get("card") or {}
    await _insert_case(session, case_id, payload, state, actor_id)
    await _insert_options(session, case_id, card.get("options") or [])

    await audit_service.append(
        session,
        action=_audit_action_for(state),
        entity_type="case",
        entity_id=case_id,
        payload={
            "site_id": payload.site_id,
            "level": payload.level,
            "route": state.get("route"),
            "selected_pill_id": state.get("selected_pill_id"),
            "option_count": len(card.get("options") or []),
        },
        actor_id=actor_id,
        actor_role=actor_role,
    )

    return DecisionCard(**{**card, "case_id": case_id})


async def get_case_card(session: AsyncSession, case_id: str) -> DecisionCard:
    """Rebuild the decision card from persisted rows."""
    result = await session.execute(
        text("""
            SELECT c.id, c.site_id, c.level, c.tenant_id, c.reported_at, c.complaint_text,
                   c.status, c.gate, c.context_check, c.metrics, t.name AS tenant_name
            FROM cases c
            LEFT JOIN tenants t ON t.id = c.tenant_id
            WHERE c.id = CAST(:case_id AS uuid)
            """),
        {"case_id": case_id},
    )
    row = result.first()
    if row is None:
        raise NotFound("Case", case_id)
    case = dict(row._mapping)

    option_rows = await session.execute(
        text("""
            SELECT d.option_id, d.pill_id, d.pill_version, d.label, d.detail, d.tier,
                   d.kwh_delta, d.sgd_delta, d.comfort_impact, d.renewal_flag, d.conflict,
                   d.source_excerpt_id, e.text AS source_excerpt
            FROM decision_options d
            LEFT JOIN transcript_excerpts e ON e.id = d.source_excerpt_id
            WHERE d.case_id = CAST(:case_id AS uuid)
            ORDER BY d.created_at ASC, d.option_id ASC
            """),
        {"case_id": case_id},
    )

    options = [
        DecisionOption(
            option_id=r.option_id,
            pill_id=r.pill_id,
            pill_version=int(r.pill_version),
            label=r.label,
            detail=r.detail or "",
            tier=r.tier,
            kwh_delta=float(r.kwh_delta) if r.kwh_delta is not None else None,
            sgd_delta=float(r.sgd_delta) if r.sgd_delta is not None else None,
            comfort_impact=r.comfort_impact,
            renewal_flag=bool(r.renewal_flag),
            conflict=r.conflict,
            source_excerpt_id=r.source_excerpt_id,
            source_excerpt=r.source_excerpt,
        )
        for r in option_rows
    ]

    gate = GateResult(**loads_if_str(case["gate"], default={}) or {})
    context = loads_if_str(case["context_check"], default=None)
    metrics = loads_if_str(case["metrics"], default=None)

    requires_approval = any(o.tier.value == "execute_with_approval" for o in options)

    return DecisionCard(
        case_id=str(case["id"]),
        site_id=case["site_id"],
        level=case["level"],
        tenant_id=case["tenant_id"],
        tenant_name=case["tenant_name"],
        reported_at=case["reported_at"],
        complaint_text=case["complaint_text"],
        status=case["status"],
        route=(
            Route.BLOCKED.value
            if case["status"] == "blocked"
            else (
                Route.ESCALATE.value
                if case["status"] == "escalated"
                else Route.EXECUTE.value if requires_approval else Route.RECOMMEND.value
            )
        ),
        gate=gate,
        context_check=ContextCheckResult(**context) if context else None,
        metrics=Metrics(**metrics) if metrics else None,
        options=options,
        selected_pill_id=options[0].pill_id if options else None,
        pill_version=options[0].pill_version if options else None,
        requires_approval=requires_approval,
    )


async def list_cases(session: AsyncSession, *, limit: int = 50) -> list[CaseRecord]:
    result = await session.execute(
        text("""
            SELECT id, site_id, asset_type, chiller_plant, tariff, tenant_id, level,
                   reported_at, complaint_text, status, signals, gate, metrics
            FROM cases
            ORDER BY reported_at DESC
            LIMIT :limit
            """),
        {"limit": limit},
    )
    records: list[CaseRecord] = []
    for row in result:
        data = dict(row._mapping)
        records.append(
            CaseRecord(
                **{
                    **data,
                    "id": str(data["id"]),
                    "signals": loads_if_str(data["signals"], default={}),
                    "gate": loads_if_str(data["gate"], default={}),
                    "metrics": loads_if_str(data["metrics"], default={}),
                }
            )
        )
    return records

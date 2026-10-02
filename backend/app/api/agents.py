"""Agent endpoints. Exposes the graph directly for demos and debugging."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.graph import run_case
from app.api.deps import get_session
from app.core.security import ANY_ROLE
from app.models.common import ApiModel
from app.models.enums import Role
from app.services import case_service

router = APIRouter(prefix="/agents", tags=["agents"])


class AgentRunRequest(ApiModel):
    """Run the graph against an explicit case. Candidates are loaded from the DB if omitted."""

    case: dict[str, Any]
    candidates: list[dict[str, Any]] | None = None
    tenant: dict[str, Any] | None = None


class AgentRunResponse(ApiModel):
    route: str
    error: str | None = None
    signals: dict[str, Any] = {}
    gate: dict[str, Any] | None = None
    context_check: dict[str, Any] | None = None
    selection: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    card: dict[str, Any] | None = None


@router.post("/run", response_model=AgentRunResponse, summary="Invoke the agent graph")
async def run_agents(
    body: AgentRunRequest,
    session: AsyncSession = Depends(get_session),
    _role: Role = Depends(ANY_ROLE),
) -> AgentRunResponse:
    candidates = (
        body.candidates
        if body.candidates is not None
        else await case_service.list_candidates(session)
    )

    state = await run_case(
        {
            "case_id": "adhoc",
            "case": body.case,
            "candidates": candidates,
            "tenant": body.tenant,
            "audit_refs": [],
        }
    )

    return AgentRunResponse(
        route=state.get("route", ""),
        error=state.get("error"),
        signals=state.get("signals") or {},
        gate=state.get("gate"),
        context_check=state.get("context_check"),
        selection=state.get("selection"),
        metrics=state.get("metrics"),
        card=state.get("card"),
    )

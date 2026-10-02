"""The single source of truth for graph state.

Nodes never store state internally: everything lives here. Each node returns a full
updated state (`{**state, ...}`) rather than mutating in place.

The graph is deliberately database-free. `candidates` and `tenant` are loaded by the
caller (app.services.case_service) before invocation, so the whole pipeline can be tested
without Postgres.
"""

from __future__ import annotations

from typing import Any, TypedDict


class AgentState(TypedDict, total=False):
    # ---- inputs (supplied by the caller) ----
    case_id: str
    case: dict[str, Any]  # the complaint + observed plant readings
    candidates: list[dict[str, Any]]  # approved pills, already loaded
    tenant: dict[str, Any] | None  # read-only renewal signal

    # ---- deterministic stages ----
    signals: dict[str, Any]  # parse_case
    gate: dict[str, Any] | None  # evaluate_gate (FR-08)
    context_check: dict[str, Any] | None  # check_context (FR-09)

    # ---- selection & computation ----
    selected_pill_id: str | None  # select_pill (only LLM-touching step)
    selected_version: int | None
    selection: dict[str, Any] | None  # how the pill was chosen (source + rationale codes)
    metrics: dict[str, Any] | None  # compute_metrics (FR-04)

    # ---- output ----
    card: dict[str, Any] | None  # assemble_card (FR-06)
    route: str  # route_action (FR-07)
    audit_refs: list[str]

    # ---- error channel: never swallow, always propagate ----
    error: str | None

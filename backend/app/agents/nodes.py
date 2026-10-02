"""Graph nodes. Every node is `verb_noun`, single responsibility, and returns full state.

Each node is wrapped so that it logs entry/exit/latency and, on any exception, sets
`state["error"]` and routes to `handle_error` — exceptions are never swallowed.

Only `select_pill` may touch a model. Everything else is pure and deterministic.
"""

from __future__ import annotations

import functools
import re
import time
from datetime import date, datetime
from typing import Any

from app.agents.state import AgentState
from app.core.logging import get_logger
from app.models.enums import ActionTier, CaseStatus, Route
from app.services import analytics, context_check, gate_service, llm, policy_service

# ---------------------------------------------------------------- deterministic parsing
_LEVEL_RE = re.compile(r"\blevel\s*(\d{1,3})\b|\b(\d{1,3})(?:st|nd|rd|th)\s+floor\b", re.I)
_MULTI_ZONE_RE = re.compile(
    r"\b(several|multiple|many|all)\s+(floors?|zones?)\b"
    r"|\bwhole\s+(building|tower)\b"
    r"|\bbuilding[- ]wide\b"
    r"|\bevery\s+floor\b"
    r"|\bthroughout\s+the\s+(building|tower)\b",
    re.I,
)
_HOT_RE = re.compile(r"\b(too hot|hot|warm|stuffy|humid|uncomfortabl\w*)\b", re.I)
_COLD_RE = re.compile(r"\b(too cold|cold|freezing|chilly|draft\w*)\b", re.I)

RENEWAL_WINDOW_DAYS = 180


def _logged(name: str, *, skip_on_error: bool = True):
    """Wrap a node with logging + error propagation.

    When an upstream node has already failed, later nodes are skipped rather than run on a
    broken state. The error and the `error` route are carried to the terminal node.
    """

    def decorator(fn):
        @functools.wraps(fn)
        async def wrapper(state: AgentState) -> AgentState:
            log = get_logger(f"node.{name}")

            if skip_on_error and state.get("error"):
                log.info("skipped — upstream error: {}", state["error"])
                return state

            started = time.perf_counter()
            log.info("enter case={}", state.get("case_id", "?"))
            try:
                result = await fn(state)
            except Exception as exc:  # noqa: BLE001 — propagate, never swallow
                log.exception("failed: {}", exc)
                return {**state, "error": f"{name}: {exc}", "route": Route.ERROR.value}
            elapsed = (time.perf_counter() - started) * 1000
            log.info("exit in {:.1f}ms route={}", elapsed, result.get("route", "-"))
            return result

        return wrapper

    return decorator


def _parse_date(value: Any) -> date | None:
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _renewal_flag(tenant: dict[str, Any] | None, reported_at: Any) -> bool:
    """Read-only renewal-risk signal: is the lease up for renewal soon?"""
    if not tenant:
        return False
    due = _parse_date(tenant.get("renewal_due"))
    reported = _parse_date(reported_at)
    if not due or not reported:
        return False
    return 0 <= (due - reported).days <= RENEWAL_WINDOW_DAYS


# ---------------------------------------------------------------- nodes
@_logged("parse_case")
async def parse_case(state: AgentState) -> AgentState:
    """Deterministically turn the complaint into signals. No model involved."""
    case = state.get("case", {})
    text = str(case.get("complaint_text", ""))

    level_match = _LEVEL_RE.search(text)
    level = None
    if level_match:
        level = int(level_match.group(1) or level_match.group(2))
    if level is None:
        level = case.get("level")

    multi_zone = bool(_MULTI_ZONE_RE.search(text))
    thermal = "hot" if _HOT_RE.search(text) else "cold" if _COLD_RE.search(text) else "unknown"

    keywords = sorted(
        {
            token
            for token, pattern in (
                ("hot", _HOT_RE),
                ("cold", _COLD_RE),
                ("multi_zone", _MULTI_ZONE_RE),
            )
            if pattern.search(text)
        }
    )

    baseline = float(case.get("baseline_kwrt") or 0.0)
    current = float(case.get("current_kwrt") or 0.0)
    drift = round(current - baseline, 4)

    signals = {
        "level": level,
        "single_zone": bool(level is not None and not multi_zone),
        "multi_zone_mentioned": multi_zone,
        "thermal": thermal,
        "keywords": keywords,
        "baseline_kwrt": baseline,
        "current_kwrt": current,
        "drift_kwrt": drift,
        "complaint_length": len(text),
    }
    return {**state, "signals": signals}


@_logged("evaluate_gate")
async def evaluate_gate(state: AgentState) -> AgentState:
    """FR-08. Runs before any model call — safety cases leave the AI path here."""
    case = state.get("case", {})
    result = gate_service.evaluate_gate(
        str(case.get("complaint_text", "")),
        requested_setpoint_c=case.get("requested_setpoint_c"),
    )
    return {**state, "gate": result.model_dump(mode="json")}


@_logged("check_context")
async def check_context(state: AgentState) -> AgentState:
    """FR-09. Filter candidates to those whose context matches this case.

    An incompatible pill is never offered to the model. If nothing matches, the case is
    blocked pending local sign-off.
    """
    case = state.get("case", {})
    candidates = state.get("candidates") or []

    if not candidates:
        return {**state, "context_check": None}

    case_context = {
        "asset_type": case.get("asset_type"),
        "chiller_plant": case.get("chiller_plant"),
        "tariff": case.get("tariff"),
    }

    compatible: list[dict[str, Any]] = []
    first_result = None
    for candidate in candidates:
        result = context_check.check_context(candidate.get("context"), case_context)
        if first_result is None:
            first_result = result
        if result.compatible:
            compatible.append(candidate)

    if compatible:
        return {
            **state,
            "candidates": compatible,
            "context_check": context_check.check_context(
                compatible[0].get("context"), case_context
            ).model_dump(mode="json"),
        }

    return {**state, "candidates": [], "context_check": first_result.model_dump(mode="json")}


@_logged("select_pill")
async def select_pill(state: AgentState) -> AgentState:
    """The only model-touching node. It returns an ID, never numbers or guidance."""
    case = state.get("case", {})
    candidates = state.get("candidates") or []

    result = llm.select_pill_by_id(
        complaint_text=str(case.get("complaint_text", "")),
        signals=state.get("signals") or {},
        candidates=candidates,
    )

    selected = next((c for c in candidates if str(c.get("id")) == result.selected_pill_id), None)
    return {
        **state,
        "selected_pill_id": result.selected_pill_id,
        "selected_version": int(selected["version"]) if selected else None,
        "selection": {
            "source": result.source,
            "rationale_codes": result.rationale_codes,
            "candidate_count": len(candidates),
        },
    }


@_logged("compute_metrics")
async def compute_metrics(state: AgentState) -> AgentState:
    """FR-04. All numbers on the card are produced here, in code."""
    selected = next(
        (
            c
            for c in (state.get("candidates") or [])
            if str(c.get("id")) == state.get("selected_pill_id")
        ),
        None,
    )
    if selected is None:
        return {**state, "metrics": None}

    case = state.get("case", {})
    metrics = analytics.compute_metrics(
        baseline_kwrt=float(case.get("baseline_kwrt") or 0.0),
        current_kwrt=float(case.get("current_kwrt") or 0.0),
        decision_logic=selected.get("decision_logic") or {},
        load_rt=case.get("load_rt"),
        wet_bulb_c=case.get("wet_bulb_c"),
    )
    return {**state, "metrics": metrics.model_dump(mode="json")}


def _base_card(state: AgentState, *, status: CaseStatus, route: Route) -> dict[str, Any]:
    case = state.get("case", {})
    tenant = state.get("tenant") or {}
    return {
        "case_id": state.get("case_id"),
        "site_id": case.get("site_id"),
        "level": case.get("level") or (state.get("signals") or {}).get("level"),
        "tenant_id": case.get("tenant_id"),
        "tenant_name": tenant.get("name"),
        "reported_at": case.get("reported_at"),
        "complaint_text": case.get("complaint_text"),
        "status": status.value,
        "route": route.value,
        "gate": state.get("gate") or {"escalate": False, "reasons": [], "matched_rules": []},
        "context_check": state.get("context_check"),
        "metrics": state.get("metrics"),
        "options": [],
        "selected_pill_id": state.get("selected_pill_id"),
        "pill_version": state.get("selected_version"),
        "requires_approval": False,
        "generated_by": (state.get("selection") or {}).get("source", "deterministic-stub"),
        "policy_hierarchy": policy_service.hierarchy_note(),
    }


@_logged("assemble_card")
async def assemble_card(state: AgentState) -> AgentState:
    """FR-06. Join deterministic numbers with pill provenance to build the decision card."""
    selected = next(
        (
            c
            for c in (state.get("candidates") or [])
            if str(c.get("id")) == state.get("selected_pill_id")
        ),
        None,
    )
    card = _base_card(state, status=CaseStatus.OPEN, route=Route.RECOMMEND)

    if selected is None:
        return {**state, "card": card}

    case = state.get("case", {})
    metrics = state.get("metrics") or {}
    levers = {lever["option_id"]: lever for lever in metrics.get("levers", [])}
    renewal = _renewal_flag(state.get("tenant"), case.get("reported_at"))
    never_do = selected.get("never_do") or []

    options: list[dict[str, Any]] = []
    requires_approval = False

    for option in selected.get("options") or []:
        lever = levers.get(str(option.get("id"))) or {}
        kwh_delta = lever.get("kwh_delta")
        tier = str(option.get("tier"))

        if tier == ActionTier.EXECUTE_WITH_APPROVAL.value:
            requires_approval = True

        options.append(
            {
                "option_id": option.get("id"),
                "pill_id": selected.get("id"),
                "pill_version": selected.get("version"),
                "label": option.get("label"),
                "detail": option.get("detail"),
                "tier": tier,
                "kwh_delta": kwh_delta,
                "sgd_delta": lever.get("sgd_delta"),
                "comfort_impact": option.get("comfort_impact"),
                "renewal_flag": renewal,
                "conflict": policy_service.detect_conflicts(
                    option=option, kwh_delta=kwh_delta, pill_never_do=never_do
                ),
                "source_excerpt_id": option.get("source_excerpt_id"),
                "source_excerpt": option.get("source_excerpt"),
            }
        )

    # Cheapest-safe-first ordering: recommend, then execute-with-approval, then escalate.
    order = {
        ActionTier.RECOMMEND.value: 0,
        ActionTier.EXECUTE_WITH_APPROVAL.value: 1,
        ActionTier.ESCALATE.value: 2,
    }
    options.sort(key=lambda o: order.get(str(o["tier"]), 9))

    card.update({"options": options, "requires_approval": requires_approval})
    return {**state, "card": card}


@_logged("route_action")
async def route_action(state: AgentState) -> AgentState:
    """FR-07. Decide the action tier for the card as a whole."""
    card = state.get("card")
    if not card or not card.get("options"):
        if card is not None:
            card = {**card, "route": Route.ESCALATE.value, "status": CaseStatus.ESCALATED.value}
        return {**state, "card": card, "route": Route.ESCALATE.value}

    route = Route.EXECUTE if card.get("requires_approval") else Route.RECOMMEND
    return {**state, "card": {**card, "route": route.value}, "route": route.value}


@_logged("escalate_case")
async def escalate_case(state: AgentState) -> AgentState:
    """A red-flag case: hand to a human with the reasons, and stop."""
    card = _base_card(state, status=CaseStatus.ESCALATED, route=Route.ESCALATE)
    return {**state, "card": card, "route": Route.ESCALATE.value}


@_logged("block_case")
async def block_case(state: AgentState) -> AgentState:
    """FR-09: context mismatch. Blocked until a local reviewer signs off."""
    card = _base_card(state, status=CaseStatus.BLOCKED, route=Route.BLOCKED)
    return {**state, "card": card, "route": Route.BLOCKED.value}


@_logged("handle_error", skip_on_error=False)
async def handle_error(state: AgentState) -> AgentState:
    """Terminal node for a failed run. The error is preserved on the state."""
    return {**state, "route": Route.ERROR.value}

"""The compiled LangGraph pipeline.

    START -> parse_case -> evaluate_gate
                             |-- escalate -> escalate_case -> END
                             '-- continue -> check_context
                                               |-- blocked -> block_case -> END
                                               '-- ok -> select_pill -> compute_metrics
                                                          -> assemble_card -> route_action -> END

Any node that raises sets `state["error"]` and is routed to `handle_error`.

Safety ordering is structural: `evaluate_gate` runs before `select_pill`, so a red-flag
case can never reach a model.
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from app.agents import nodes
from app.agents.state import AgentState
from app.models.enums import Route

# The only values a router may return. Anything else would break graph compilation.
VALID_ROUTES: set[str] = {route.value for route in Route}

RECURSION_LIMIT = 10


def route_after_gate(state: AgentState) -> str:
    if state.get("error"):
        return Route.ERROR.value
    gate = state.get("gate") or {}
    return Route.ESCALATE.value if gate.get("escalate") else Route.CONTINUE.value


def route_after_context(state: AgentState) -> str:
    if state.get("error"):
        return Route.ERROR.value

    if not (state.get("candidates") or []):
        check = state.get("context_check") or {}
        if check.get("compatible") is False:
            return Route.BLOCKED.value

    return Route.OK.value


def build_graph() -> Any:
    builder = StateGraph(AgentState)

    builder.add_node("parse_case", nodes.parse_case)
    builder.add_node("evaluate_gate", nodes.evaluate_gate)
    builder.add_node("check_context", nodes.check_context)
    builder.add_node("select_pill", nodes.select_pill)
    builder.add_node("compute_metrics", nodes.compute_metrics)
    builder.add_node("assemble_card", nodes.assemble_card)
    builder.add_node("route_action", nodes.route_action)
    builder.add_node("escalate_case", nodes.escalate_case)
    builder.add_node("block_case", nodes.block_case)
    builder.add_node("handle_error", nodes.handle_error)

    builder.add_edge(START, "parse_case")
    builder.add_edge("parse_case", "evaluate_gate")
    builder.add_conditional_edges(
        "evaluate_gate",
        route_after_gate,
        {
            Route.ESCALATE.value: "escalate_case",
            Route.CONTINUE.value: "check_context",
            Route.ERROR.value: "handle_error",
        },
    )
    builder.add_conditional_edges(
        "check_context",
        route_after_context,
        {
            Route.BLOCKED.value: "block_case",
            Route.OK.value: "select_pill",
            Route.ERROR.value: "handle_error",
        },
    )
    builder.add_edge("select_pill", "compute_metrics")
    builder.add_edge("compute_metrics", "assemble_card")
    builder.add_edge("assemble_card", "route_action")

    for terminal in ("escalate_case", "block_case", "route_action", "handle_error"):
        builder.add_edge(terminal, END)

    return builder.compile()


graph = build_graph()

# Every key the graph may produce, with its neutral value. Seeding these means a caller
# never has to know the full state shape, and `state["error"]` is always present.
_STATE_DEFAULTS: AgentState = {
    "signals": {},
    "gate": None,
    "context_check": None,
    "selected_pill_id": None,
    "selected_version": None,
    "selection": None,
    "metrics": None,
    "card": None,
    "route": "",
    "audit_refs": [],
    "error": None,
}


async def run_case(state: AgentState) -> AgentState:
    """Invoke the graph with a bounded recursion limit."""
    merged: AgentState = {**_STATE_DEFAULTS, **state}
    return await graph.ainvoke(merged, config={"recursion_limit": RECURSION_LIMIT})

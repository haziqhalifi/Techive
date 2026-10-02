"""End-to-end pipeline tests for the hero case and the three exits.

No database required: `candidates` and `tenant` are injected, exactly as case_service
does at runtime.
"""

from __future__ import annotations

import pytest

from app.agents.graph import RECURSION_LIMIT, VALID_ROUTES, run_case
from app.models.enums import Route


async def _run(case, candidates, tenant=None):
    return await run_case(
        {
            "case_id": "case-test",
            "case": case,
            "candidates": candidates,
            "tenant": tenant,
            "audit_refs": [],
        }
    )


# ---------------------------------------------------------------- hero path
async def test_hero_case_produces_an_execute_tier_card(hero_case, hero_candidate, hero_tenant):
    state = await _run(hero_case, [hero_candidate], hero_tenant)

    assert state["error"] is None
    assert state["route"] == Route.EXECUTE.value

    card = state["card"]
    assert card["status"] == "open"
    assert card["selected_pill_id"] == "pill-energy-chiller-drift"
    assert card["pill_version"] == 2
    assert card["requires_approval"] is True
    assert len(card["options"]) == 3


async def test_hero_options_are_ordered_safest_first(hero_case, hero_candidate, hero_tenant):
    state = await _run(hero_case, [hero_candidate], hero_tenant)
    tiers = [option["tier"] for option in state["card"]["options"]]
    assert tiers == ["recommend", "execute_with_approval", "escalate"]


async def test_hero_numbers_come_from_analytics(hero_case, hero_candidate, hero_tenant):
    state = await _run(hero_case, [hero_candidate], hero_tenant)
    by_id = {option["option_id"]: option for option in state["card"]["options"]}

    assert state["metrics"]["drift_kwrt"] == pytest.approx(0.09)
    assert by_id["opt-inspect-vav"]["kwh_delta"] == pytest.approx(0.0)
    assert by_id["opt-resequence-chillers"]["kwh_delta"] == pytest.approx(-1285.2)
    assert by_id["opt-setpoint-drop"]["kwh_delta"] == pytest.approx(642.6)


async def test_building_wide_setpoint_drop_is_flagged_as_a_conflict(
    hero_case, hero_candidate, hero_tenant
):
    state = await _run(hero_case, [hero_candidate], hero_tenant)
    by_id = {option["option_id"]: option for option in state["card"]["options"]}

    conflict = by_id["opt-setpoint-drop"]["conflict"]
    assert conflict is not None
    assert "never_do" in conflict
    assert "Increases plant energy" in conflict

    # The clean options carry no conflict flag.
    assert by_id["opt-inspect-vav"]["conflict"] is None


async def test_every_option_cites_a_pill_version_and_excerpt(
    hero_case, hero_candidate, hero_tenant
):
    """FR-06 provenance coverage must be 100%."""
    state = await _run(hero_case, [hero_candidate], hero_tenant)
    for option in state["card"]["options"]:
        assert option["pill_version"] == 2
        assert option["pill_id"] == "pill-energy-chiller-drift"
        assert option["source_excerpt_id"], f"{option['option_id']} has no excerpt"
        assert option["source_excerpt"]


async def test_renewal_flag_is_set_for_a_lease_due_soon(hero_case, hero_candidate, hero_tenant):
    state = await _run(hero_case, [hero_candidate], hero_tenant)
    assert all(option["renewal_flag"] is True for option in state["card"]["options"])


async def test_renewal_flag_is_clear_when_no_tenant(hero_case, hero_candidate):
    state = await _run(hero_case, [hero_candidate], tenant=None)
    assert all(option["renewal_flag"] is False for option in state["card"]["options"])


async def test_card_reports_how_the_pill_was_chosen(hero_case, hero_candidate):
    state = await _run(hero_case, [hero_candidate])
    assert state["card"]["generated_by"] == "stub"
    assert state["selection"]["source"] == "stub"


# ---------------------------------------------------------------- exit 1: red flag
async def test_red_flag_bypasses_the_model_entirely(monkeypatch, hero_case, hero_candidate):
    """FR-08 ordering: a safety case must never reach a model call."""

    def _must_not_be_called(**_kwargs):
        raise AssertionError("the model was called for a red-flag case")

    monkeypatch.setattr("app.services.llm.select_pill_by_id", _must_not_be_called)

    case = {**hero_case, "complaint_text": "Strong chemical odour on level 23"}
    state = await _run(case, [hero_candidate])

    assert state["route"] == Route.ESCALATE.value
    assert state["card"]["status"] == "escalated"
    assert state["card"]["options"] == []
    assert state["card"]["gate"]["escalate"] is True
    assert "safety.odour" in state["card"]["gate"]["matched_rules"]


async def test_out_of_band_setpoint_escalates(hero_case, hero_candidate):
    case = {**hero_case, "requested_setpoint_c": 18.0}
    state = await _run(case, [hero_candidate])
    assert state["route"] == Route.ESCALATE.value
    assert "safety.setpoint_out_of_band" in state["card"]["gate"]["matched_rules"]


# ---------------------------------------------------------------- exit 2: context block
async def test_transfer_to_a_different_plant_is_blocked(hero_case, hero_candidate):
    case = {**hero_case, "chiller_plant": "air_cooled_2x"}
    state = await _run(case, [hero_candidate])

    assert state["route"] == Route.BLOCKED.value
    assert state["card"]["status"] == "blocked"
    assert state["context_check"]["compatible"] is False
    assert "chiller_plant" in state["context_check"]["mismatches"][0]


async def test_incompatible_pill_never_reaches_selection(monkeypatch, hero_case, hero_candidate):
    def _must_not_be_called(**_kwargs):
        raise AssertionError("an incompatible pill must not reach the model")

    monkeypatch.setattr("app.services.llm.select_pill_by_id", _must_not_be_called)

    case = {**hero_case, "chiller_plant": "air_cooled_2x"}
    state = await _run(case, [hero_candidate])
    assert state["route"] == Route.BLOCKED.value


# ---------------------------------------------------------------- exit 3: nothing matches
async def test_no_candidates_escalates_to_a_human(hero_case):
    state = await _run(hero_case, [])
    assert state["route"] == Route.ESCALATE.value
    assert state["selected_pill_id"] is None
    assert state["card"]["options"] == []


# ---------------------------------------------------------------- error handling
async def test_node_failure_sets_error_and_short_circuits(hero_case, hero_candidate):
    case = {**hero_case, "baseline_kwrt": "not-a-number"}
    state = await _run(case, [hero_candidate])

    assert state["error"] is not None
    assert state["route"] == Route.ERROR.value
    assert state["route"] in VALID_ROUTES


async def test_all_terminal_routes_are_declared(hero_case, hero_candidate, hero_tenant):
    for candidates, case in (
        ([hero_candidate], hero_case),
        ([], hero_case),
        ([hero_candidate], {**hero_case, "chiller_plant": "air_cooled_2x"}),
        ([hero_candidate], {**hero_case, "complaint_text": "odour on level 23"}),
    ):
        state = await _run(case, candidates, hero_tenant)
        assert state["route"] in VALID_ROUTES


def test_recursion_limit_is_bounded():
    assert RECURSION_LIMIT == 10
    assert len(VALID_ROUTES) == len(set(VALID_ROUTES))

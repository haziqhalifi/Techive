"""FR-08 — the red-flag gate. Recall is the contract: a missed escalation is unacceptable."""

from __future__ import annotations

import pytest

from app.services.gate_service import evaluate_gate

ESCALATING = [
    ("Strong chemical odour on level 12", ["safety.odour"]),
    ("Staff feel nauseous and dizzy near the AHU", ["safety.illness"]),
    ("Smoke coming from the riser cupboard", ["safety.smoke_fire"]),
    ("Legionella detected in the cooling tower sample", ["safety.legionella"]),
    ("Cooling tower water test shows bacteria above limit", ["safety.cooling_tower_test"]),
    ("Water leaking through the ceiling into the server room", ["safety.water_ingress"]),
    ("Possible refrigerant leak with a strong smell in the plant room", ["safety.odour"]),
]

BENIGN = [
    "Level 23 is too hot this afternoon",
    "Meeting room on level 7 feels warm",
    "Chiller plant efficiency looks high today",
    "The cooling tower is due for its routine inspection next month",
    "Tenant reports the aircon is a bit noisy",
    "The VAV damper on level 23 may be stuck low",
]


@pytest.mark.parametrize(("text", "expected_rules"), ESCALATING)
def test_red_flags_escalate(text, expected_rules):
    result = evaluate_gate(text)
    assert result.escalate is True
    for rule in expected_rules:
        assert rule in result.matched_rules
    assert result.reasons  # a human always gets a reason


@pytest.mark.parametrize("text", BENIGN)
def test_ordinary_comfort_cases_do_not_escalate(text):
    result = evaluate_gate(text)
    assert result.escalate is False, f"false escalation on: {text} ({result.matched_rules})"
    assert result.matched_rules == []


def test_out_of_band_setpoint_escalates():
    result = evaluate_gate("Please cool the whole tower", requested_setpoint_c=18.0)
    assert result.escalate is True
    assert "safety.setpoint_out_of_band" in result.matched_rules


def test_in_band_setpoint_does_not_escalate():
    result = evaluate_gate("Zone feels warm", requested_setpoint_c=24.5)
    assert result.escalate is False


def test_band_boundaries_are_inclusive():
    assert evaluate_gate("x", requested_setpoint_c=23.0).escalate is False
    assert evaluate_gate("x", requested_setpoint_c=25.0).escalate is False
    assert evaluate_gate("x", requested_setpoint_c=25.1).escalate is True


def test_rule_ids_are_deduplicated():
    result = evaluate_gate("Odour and a smell near the AHU")
    assert result.matched_rules.count("safety.odour") == 1
    assert len(result.reasons) == len(result.matched_rules)


def test_empty_text_is_safe():
    result = evaluate_gate("")
    assert result.escalate is False

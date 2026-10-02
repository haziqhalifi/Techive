"""FR-09 — a pill captured for one context must not silently transfer to another."""

from __future__ import annotations

import pytest

from app.services.context_check import check_context, summarise

TOWER_K_PILL_CONTEXT = {
    "asset_type": "office",
    "chiller_plant": "water_cooled_3x",
    "tariff": "SG_commercial",
}

TOWER_K_CASE_CONTEXT = {
    "asset_type": "office",
    "chiller_plant": "water_cooled_3x",
    "tariff": "SG_commercial",
}

# Tower B: a different plant. The pill must be blocked until a local reviewer signs off.
TOWER_B_CASE_CONTEXT = {
    "asset_type": "office",
    "chiller_plant": "air_cooled_2x",
    "tariff": "SG_commercial",
}


def test_matching_context_is_compatible():
    result = check_context(TOWER_K_PILL_CONTEXT, TOWER_K_CASE_CONTEXT)
    assert result.compatible is True
    assert result.requires_local_signoff is False
    assert result.mismatches == []


def test_tower_k_pill_blocked_at_tower_b():
    result = check_context(TOWER_K_PILL_CONTEXT, TOWER_B_CASE_CONTEXT)
    assert result.compatible is False
    assert result.requires_local_signoff is True
    assert len(result.mismatches) == 1
    assert "chiller_plant" in result.mismatches[0]


def test_tariff_mismatch_blocks():
    result = check_context(
        TOWER_K_PILL_CONTEXT, {**TOWER_K_CASE_CONTEXT, "tariff": "MY_commercial"}
    )
    assert result.compatible is False
    assert "tariff" in result.mismatches[0]


def test_missing_key_on_pill_blocks():
    pill_context = {"asset_type": "office", "tariff": "SG_commercial"}  # no chiller_plant
    result = check_context(pill_context, TOWER_K_CASE_CONTEXT)
    assert result.compatible is False
    assert "does not declare" in result.mismatches[0]


def test_missing_key_on_case_blocks():
    case_context = {"asset_type": "office", "tariff": "SG_commercial"}  # no chiller_plant
    result = check_context(TOWER_K_PILL_CONTEXT, case_context)
    assert result.compatible is False


def test_empty_contexts_block_rather_than_allow():
    assert check_context({}, {}).compatible is False
    assert check_context(None, None).compatible is False


def test_multiple_mismatches_are_all_reported():
    result = check_context(
        TOWER_K_PILL_CONTEXT,
        {"asset_type": "data_centre", "chiller_plant": "air_cooled_2x", "tariff": "MY_commercial"},
    )
    assert len(result.mismatches) == 3


@pytest.mark.parametrize("compatible", [True, False])
def test_summarise_always_returns_a_sentence(compatible):
    case_context = TOWER_K_CASE_CONTEXT if compatible else TOWER_B_CASE_CONTEXT
    result = check_context(TOWER_K_PILL_CONTEXT, case_context)
    assert summarise(result).endswith(".")

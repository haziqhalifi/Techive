"""Shared fixtures.

The deterministic core (analytics, gate, context check, audit chain maths, claim
validation) is pure, so these tests need no database. Tests that require Postgres are
marked `db` and skipped when DATABASE_URL is unreachable.
"""

from __future__ import annotations

import pytest

from app.services.analytics import compute_metrics

# The hero case: Level 23 complaint while the chiller plant drifts.
HERO_BASELINE_KWRT = 0.62
HERO_CURRENT_KWRT = 0.71
HERO_WET_BULB_C = 33.1


@pytest.fixture
def hero_decision_logic() -> dict:
    """The decision_logic block stored on the approved energy pill."""
    return {
        "design_kwrt": 0.60,
        "baseline_kwrt": 0.62,
        "drift_threshold": 0.05,
        "energy_price_sgd_per_kwh": 0.28,
        "comfort_band_c": [23.0, 25.0],
        "horizon_hours": 24,
        "load_rt": 850.0,
        "lever_recovery": {
            "opt-inspect-vav": 0.0,
            "opt-resequence-chillers": 0.70,
            "opt-setpoint-drop": -0.35,
        },
    }


@pytest.fixture
def hero_metrics(hero_decision_logic):
    return compute_metrics(
        baseline_kwrt=HERO_BASELINE_KWRT,
        current_kwrt=HERO_CURRENT_KWRT,
        decision_logic=hero_decision_logic,
        wet_bulb_c=HERO_WET_BULB_C,
    )


# ---------------------------------------------------------------- graph fixtures
# These mirror what app.services.case_service loads from the database, so the whole
# pipeline can be exercised without Postgres.

TOWER_K_CONTEXT = {
    "asset_type": "office",
    "chiller_plant": "water_cooled_3x",
    "tariff": "SG_commercial",
}


@pytest.fixture
def hero_case() -> dict:
    return {
        "site_id": "SGT-01",
        "asset_type": "office",
        "chiller_plant": "water_cooled_3x",
        "tariff": "SG_commercial",
        "tenant_id": "L23-ACME",
        "level": 23,
        "reported_at": "2026-10-02T14:40:00+08:00",
        "complaint_text": "Level 23 ACME — it's too hot in our meeting rooms this afternoon.",
        "baseline_kwrt": HERO_BASELINE_KWRT,
        "current_kwrt": HERO_CURRENT_KWRT,
        "load_rt": 850.0,
        "wet_bulb_c": HERO_WET_BULB_C,
    }


@pytest.fixture
def hero_tenant() -> dict:
    return {
        "id": "L23-ACME",
        "name": "ACME Manufacturing",
        "level": 23,
        "renewal_due": "2026-11-15",
    }


@pytest.fixture
def hero_candidate(hero_decision_logic) -> dict:
    return {
        "id": "pill-energy-chiller-drift",
        "title": "Zone complaint during plant drift",
        "domain": "energy",
        "version": 2,
        "context": TOWER_K_CONTEXT,
        "triggers": ["Comfort complaint while kW/RT is above baseline"],
        "never_do": ["Never lower the building-wide setpoint for a single-zone complaint"],
        "decision_logic": hero_decision_logic,
        "trade_offs": {},
        "options": [
            {
                "id": "opt-inspect-vav",
                "tier": "recommend",
                "label": "Inspect the L23 VAV damper and zone sensor",
                "detail": "Check the zone air path first; no plant change and no energy cost.",
                "comfort_impact": "comfort restored in zone",
                "source_excerpt_id": "ex-4",
                "source_excerpt": "When one floor complains, I look at that floor, not the plant.",
            },
            {
                "id": "opt-resequence-chillers",
                "tier": "execute_with_approval",
                "label": "Re-sequence chillers within the approved band",
                "detail": "Recovers plant efficiency once drift exceeds the threshold.",
                "comfort_impact": "comfort restored in zone",
                "source_excerpt_id": "ex-6",
                "source_excerpt": "If it is many zones on different facades, now I look at the plant.",
            },
            {
                "id": "opt-setpoint-drop",
                "tier": "escalate",
                "label": "Lower the building-wide setpoint",
                "detail": "Never for a single-zone complaint.",
                "comfort_impact": "zone fixed; whole-tower plant kWh rises",
                "source_excerpt_id": "ex-7",
                "source_excerpt": "I never drop the whole building setpoint to fix one hot floor.",
            },
        ],
    }

"""Integration: the committed seed artifacts drive the hero case to the right card.

This is the database-free stand-in for the live smoke test. It loads the exact files that
populate Postgres (data/seed_pills.json, data/seed_tower.json) and runs the real graph, so
a drift in the generated data breaks the build rather than the demo.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.agents.graph import run_case
from app.models.enums import Route

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "data"


def _load(name: str) -> dict:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def seed_pills() -> dict:
    return _load("seed_pills.json")


@pytest.fixture(scope="module")
def seed_tower() -> dict:
    return _load("seed_tower.json")


@pytest.fixture(scope="module")
def seeded_pill(seed_pills) -> dict:
    return seed_pills["pills"][0]


@pytest.fixture(scope="module")
def live_version(seeded_pill) -> dict:
    approved = [v for v in seeded_pill["versions"] if v["status"] == "approved"]
    assert approved, "seed must contain an approved version"
    return max(approved, key=lambda v: v["version"])


@pytest.fixture(scope="module")
def seeded_candidate(seeded_pill, live_version) -> dict:
    """The same shape app.services.case_service.list_candidates builds from the DB."""
    return {
        "id": seeded_pill["id"],
        "title": seeded_pill["title"],
        "domain": seeded_pill["domain"],
        "version": live_version["version"],
        "context": seeded_pill["context"],
        "triggers": seeded_pill["triggers"],
        "never_do": seeded_pill["never_do"],
        "decision_logic": seeded_pill["decision_logic"],
        "trade_offs": seeded_pill["trade_offs"],
        "options": live_version["options"],
    }


@pytest.fixture(scope="module")
def seeded_tenant(seed_tower) -> dict:
    hero = seed_tower["hero_case"]
    return next(t for t in seed_tower["tenants"] if t["id"] == hero["tenant_id"])


# ---------------------------------------------------------------- seed integrity
def test_seed_is_labelled_synthetic(seed_pills, seed_tower):
    assert "SYNTHETIC" in seed_pills["_notice"]
    assert "SYNTHETIC" in seed_tower["_notice"]


def test_seed_has_exactly_one_approved_version(seeded_pill, live_version):
    assert live_version["version"] == seeded_pill["current_version"]
    assert live_version["eval_status"] == "passed"


def test_seed_contains_a_failed_proposal_for_the_rollback_demo(seeded_pill):
    failed = [v for v in seeded_pill["versions"] if v["eval_status"] == "failed"]
    assert failed, "the FR-10 rollback story needs a version that failed its eval"
    assert failed[0]["version"] > seeded_pill["current_version"]


def test_every_grounded_seed_claim_cites_an_excerpt(live_version):
    """FR-02 holds in the generated data, not just in the validator."""
    for claim in live_version["claims"]:
        if claim["kind"] != "unknown":
            assert claim["source_excerpt_id"], f"ungrounded claim: {claim['text']}"


def test_seed_has_one_unknown_claim(live_version):
    unknowns = [c for c in live_version["claims"] if c["kind"] == "unknown"]
    assert len(unknowns) == 1
    assert unknowns[0]["source_excerpt_id"] is None


def test_every_seed_option_cites_an_excerpt(live_version):
    """FR-06 provenance coverage on the generated data."""
    for option in live_version["options"]:
        assert option["source_excerpt_id"], f"{option['id']} has no excerpt"


def test_seed_chiller_series_drifts_from_baseline_to_current(seed_tower):
    summary = seed_tower["chiller_summary"]
    hero = seed_tower["hero_case"]
    assert summary["first_day_mean_kwrt"] == pytest.approx(hero["baseline_kwrt"], abs=0.005)
    assert summary["last_day_mean_kwrt"] == pytest.approx(hero["current_kwrt"], abs=0.005)
    assert hero["current_kwrt"] > hero["baseline_kwrt"]


# ---------------------------------------------------------------- pipeline on seed data
async def test_seeded_hero_case_reaches_the_expected_card(
    seed_tower, seeded_candidate, seeded_tenant
):
    state = await run_case(
        {
            "case_id": "seed-hero",
            "case": seed_tower["hero_case"],
            "candidates": [seeded_candidate],
            "tenant": seeded_tenant,
            "audit_refs": [],
        }
    )

    assert state["error"] is None
    assert state["route"] == Route.EXECUTE.value

    card = state["card"]
    assert card["selected_pill_id"] == "pill-energy-chiller-drift"
    assert card["pill_version"] == 2
    assert card["requires_approval"] is True

    by_id = {option["option_id"]: option for option in card["options"]}
    assert by_id["opt-resequence-chillers"]["tier"] == "execute_with_approval"
    assert by_id["opt-resequence-chillers"]["kwh_delta"] == pytest.approx(-1285.2)
    assert by_id["opt-setpoint-drop"]["conflict"] is not None
    assert by_id["opt-inspect-vav"]["renewal_flag"] is True


async def test_seeded_hero_case_never_lowers_the_building_setpoint(
    seed_tower, seeded_candidate, seeded_tenant
):
    """Goal 3 from the PRD: zero recommendations to lower a building-wide setpoint."""
    state = await run_case(
        {
            "case_id": "seed-hero",
            "case": seed_tower["hero_case"],
            "candidates": [seeded_candidate],
            "tenant": seeded_tenant,
            "audit_refs": [],
        }
    )

    actionable = [
        option
        for option in state["card"]["options"]
        if option["tier"] in ("recommend", "execute_with_approval")
    ]
    assert all("setpoint" not in option["option_id"] for option in actionable)

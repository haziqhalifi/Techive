"""FR-04 — deterministic analytics. These numbers are the contract shown on the card."""

from __future__ import annotations

import pytest

from app.services.analytics import (
    DEFAULT_ENERGY_PRICE_SGD_PER_KWH,
    compute_metrics,
    lever_savings_map,
    weather_normalise_kwh,
)


def test_hero_drift_and_excess(hero_metrics):
    # 0.71 - 0.62 = 0.09 kW/RT over a 850 RT load for 24h
    assert hero_metrics.drift_kwrt == pytest.approx(0.09)
    assert hero_metrics.excess_kw == pytest.approx(76.5)
    assert hero_metrics.excess_kwh == pytest.approx(1836.0)
    assert hero_metrics.excess_sgd == pytest.approx(514.08)
    assert hero_metrics.exceeds_threshold is True


def test_hero_drift_pct(hero_metrics):
    assert hero_metrics.drift_pct == pytest.approx(0.09 / 0.62, abs=1e-4)


def test_hero_lever_savings(hero_metrics):
    levers = lever_savings_map(hero_metrics)

    # Re-sequencing recovers 70% of the excess -> saves energy (negative delta).
    assert levers["opt-resequence-chillers"].kwh_delta == pytest.approx(-1285.2)
    assert levers["opt-resequence-chillers"].sgd_delta == pytest.approx(-359.86)

    # The VAV inspection does not touch plant energy.
    assert levers["opt-inspect-vav"].kwh_delta == pytest.approx(0.0)

    # A building-wide setpoint drop WASTES energy (positive delta) — the never_do case.
    assert levers["opt-setpoint-drop"].kwh_delta == pytest.approx(642.6)
    assert levers["opt-setpoint-drop"].kwh_delta > 0


def test_drift_below_threshold_is_not_flagged():
    metrics = compute_metrics(
        baseline_kwrt=0.62,
        current_kwrt=0.63,
        decision_logic={"drift_threshold": 0.05, "lever_recovery": {}},
    )
    assert metrics.drift_kwrt == pytest.approx(0.01)
    assert metrics.exceeds_threshold is False


def test_defaults_apply_when_logic_is_empty():
    metrics = compute_metrics(baseline_kwrt=0.60, current_kwrt=0.70, decision_logic={})
    assert metrics.energy_price_sgd_per_kwh == pytest.approx(DEFAULT_ENERGY_PRICE_SGD_PER_KWH)
    assert metrics.load_rt > 0
    assert metrics.levers == []


def test_weather_normalisation_deflates_warm_readings():
    # Warmer than the 27C reference => measured energy is inflated, so normalised is lower.
    assert weather_normalise_kwh(1000.0, 33.1) < 1000.0
    # Exactly at reference => unchanged.
    assert weather_normalise_kwh(1000.0, 27.0) == pytest.approx(1000.0)
    # No reading => unchanged (never invent a number).
    assert weather_normalise_kwh(1000.0, None) == pytest.approx(1000.0)


def test_hero_weather_normalised_is_lower_than_raw(hero_metrics):
    assert hero_metrics.weather_normalised_excess_kwh < hero_metrics.excess_kwh


def test_zero_baseline_does_not_divide_by_zero():
    metrics = compute_metrics(baseline_kwrt=0.0, current_kwrt=0.1, decision_logic={})
    assert metrics.drift_pct == 0.0

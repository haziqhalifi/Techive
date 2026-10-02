"""FR-04 — deterministic analytics.

Pure functions, no I/O, no LLM. Every number on the decision card is produced here.

    drift        = current_kwrt - baseline_kwrt
    excess_kw    = drift * load_rt
    excess_kwh   = excess_kw * horizon_hours
    lever_kwh    = -(recovery_fraction * excess_kwh)

A lever with a positive recovery fraction saves energy (negative kWh delta); a negative
fraction models a lever that wastes it (e.g. a building-wide setpoint drop).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from app.models.case import LeverSaving, Metrics

# Fallbacks when a pill's decision_logic omits a parameter.
DEFAULT_LOAD_RT = 850.0
DEFAULT_HORIZON_HOURS = 24.0
DEFAULT_ENERGY_PRICE_SGD_PER_KWH = 0.28
DEFAULT_DRIFT_THRESHOLD = 0.05

# Weather normalisation: scale measured energy back to a reference wet-bulb temperature.
REFERENCE_WET_BULB_C = 27.0
WET_BULB_SENSITIVITY_PER_DEG = 0.025


def _num(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def weather_normalise_kwh(
    kwh: float,
    wet_bulb_c: float | None,
    *,
    reference_wb_c: float = REFERENCE_WET_BULB_C,
    sensitivity_per_deg: float = WET_BULB_SENSITIVITY_PER_DEG,
) -> float:
    """Scale measured kWh to the reference weather.

    Warmer than reference means the plant worked harder than the baseline conditions, so
    the measured figure is deflated. Returns `kwh` unchanged when no wet-bulb is supplied.
    """
    if wet_bulb_c is None:
        return kwh
    factor = max(0.5, 1.0 + sensitivity_per_deg * (wet_bulb_c - reference_wb_c))
    return kwh / factor


def compute_metrics(
    *,
    baseline_kwrt: float,
    current_kwrt: float,
    decision_logic: Mapping[str, Any] | None = None,
    load_rt: float | None = None,
    horizon_hours: float | None = None,
    energy_price_sgd_per_kwh: float | None = None,
    wet_bulb_c: float | None = None,
) -> Metrics:
    """Compute the plant drift and the per-lever kWh impact. Deterministic."""
    logic: Mapping[str, Any] = decision_logic or {}

    load = _num(load_rt if load_rt is not None else logic.get("load_rt"), DEFAULT_LOAD_RT)
    hours = _num(
        horizon_hours if horizon_hours is not None else logic.get("horizon_hours"),
        DEFAULT_HORIZON_HOURS,
    )
    price = _num(
        (
            energy_price_sgd_per_kwh
            if energy_price_sgd_per_kwh is not None
            else logic.get("energy_price_sgd_per_kwh")
        ),
        DEFAULT_ENERGY_PRICE_SGD_PER_KWH,
    )
    threshold = _num(logic.get("drift_threshold"), DEFAULT_DRIFT_THRESHOLD)
    recovery = logic.get("lever_recovery") or {}

    drift = current_kwrt - baseline_kwrt
    drift_pct = (drift / baseline_kwrt) if baseline_kwrt else 0.0
    excess_kw = drift * load
    excess_kwh = excess_kw * hours
    excess_sgd = excess_kwh * price

    levers: list[LeverSaving] = []
    if isinstance(recovery, Mapping):
        for option_id in sorted(recovery):
            fraction = _num(recovery[option_id], 0.0)
            kwh_delta = -(fraction * excess_kwh)
            if kwh_delta == 0:
                kwh_delta = 0.0  # avoid negative zero in the JSON payload
            levers.append(
                LeverSaving(
                    option_id=str(option_id),
                    kwh_delta=round(kwh_delta, 2),
                    sgd_delta=round(kwh_delta * price, 2),
                )
            )

    return Metrics(
        baseline_kwrt=round(baseline_kwrt, 4),
        current_kwrt=round(current_kwrt, 4),
        drift_kwrt=round(drift, 4),
        drift_pct=round(drift_pct, 4),
        exceeds_threshold=abs(drift) >= threshold,
        load_rt=round(load, 2),
        horizon_hours=round(hours, 2),
        energy_price_sgd_per_kwh=round(price, 4),
        excess_kw=round(excess_kw, 2),
        excess_kwh=round(excess_kwh, 2),
        excess_sgd=round(excess_sgd, 2),
        weather_normalised_excess_kwh=round(weather_normalise_kwh(excess_kwh, wet_bulb_c), 2),
        wet_bulb_c=wet_bulb_c,
        levers=levers,
    )


def lever_savings_map(metrics: Metrics) -> dict[str, LeverSaving]:
    """Convenience index for assembling the decision card."""
    return {lever.option_id: lever for lever in metrics.levers}

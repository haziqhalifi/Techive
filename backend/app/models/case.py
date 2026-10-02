"""Decision-runtime models: cases, the deterministic gate/metrics, and the decision card."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from app.models.common import DATA_NOTICE, ApiModel
from app.models.enums import ActionTier, CaseStatus, Route


# ---------------------------------------------------------------- deterministic results
class GateResult(ApiModel):
    """FR-08 red-flag gate. Produced by pure rules, BEFORE any LLM call."""

    escalate: bool
    reasons: list[str] = Field(default_factory=list)
    matched_rules: list[str] = Field(default_factory=list)


class ContextCheckResult(ApiModel):
    """FR-09 transfer check. Deterministic comparison of pill context vs case context."""

    compatible: bool
    mismatches: list[str] = Field(default_factory=list)
    requires_local_signoff: bool = False


class LeverSaving(ApiModel):
    option_id: str
    kwh_delta: float  # negative = saves energy
    sgd_delta: float


class Metrics(ApiModel):
    """FR-04 output. Computed in code by app.services.analytics — never by the LLM."""

    baseline_kwrt: float
    current_kwrt: float
    drift_kwrt: float
    drift_pct: float
    exceeds_threshold: bool
    load_rt: float
    horizon_hours: float
    energy_price_sgd_per_kwh: float
    excess_kw: float
    excess_kwh: float
    excess_sgd: float
    weather_normalised_excess_kwh: float
    wet_bulb_c: float | None = None
    levers: list[LeverSaving] = Field(default_factory=list)
    note: str = "Computed deterministically in code. The LLM never produces these numbers."


# ---------------------------------------------------------------- case I/O
class CaseCreate(ApiModel):
    """A comfort complaint plus the plant readings observed at the time."""

    site_id: str = "SGT-01"
    asset_type: str = "office"
    chiller_plant: str = "water_cooled_3x"
    tariff: str = "SG_commercial"
    tenant_id: str | None = None
    level: int | None = None
    reported_at: datetime
    complaint_text: str = Field(min_length=3, max_length=2000)

    baseline_kwrt: float = Field(gt=0, le=5)
    current_kwrt: float = Field(gt=0, le=5)
    load_rt: float | None = Field(default=None, gt=0)
    wet_bulb_c: float | None = None
    # If a caller asks for an out-of-band setpoint, the gate escalates (FR-08).
    requested_setpoint_c: float | None = None


class CaseRecord(ApiModel):
    id: str
    site_id: str
    asset_type: str
    chiller_plant: str
    tariff: str
    tenant_id: str | None = None
    level: int | None = None
    reported_at: datetime
    complaint_text: str
    status: CaseStatus
    signals: dict[str, Any] | None = None
    gate: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None


class DecisionOption(ApiModel):
    """One option on the card. Numbers come from analytics.py; provenance from the pill."""

    option_id: str
    pill_id: str
    pill_version: int
    label: str
    detail: str
    tier: ActionTier
    kwh_delta: float | None = None
    sgd_delta: float | None = None
    comfort_impact: str | None = None
    renewal_flag: bool = False
    conflict: str | None = None
    source_excerpt_id: str | None = None
    source_excerpt: str | None = None


class DecisionCard(ApiModel):
    case_id: str
    site_id: str
    level: int | None = None
    tenant_id: str | None = None
    tenant_name: str | None = None
    reported_at: datetime
    complaint_text: str
    status: CaseStatus
    route: Route
    gate: GateResult
    context_check: ContextCheckResult | None = None
    metrics: Metrics | None = None
    options: list[DecisionOption] = Field(default_factory=list)
    selected_pill_id: str | None = None
    pill_version: int | None = None
    requires_approval: bool = False
    generated_by: str = "deterministic-stub"
    policy_hierarchy: str | None = None
    data_notice: str = DATA_NOTICE


class CaseListResponse(ApiModel):
    count: int
    cases: list[CaseRecord]

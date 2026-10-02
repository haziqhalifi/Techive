"""Intelligence Pill models.

A pill is a versioned, owned record of one area of expertise. Every statement in it is
typed and traced back to what the expert actually said.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from app.models.common import ApiModel
from app.models.enums import ActionTier, ClaimKind, EvalStatus, PillDomain, PillStatus
from app.models.transcript import TranscriptExcerpt


class Claim(ApiModel):
    """One statement inside a pill version.

    FR-02: `unknown` is the only kind permitted to have no source excerpt. A non-unknown
    claim without a real `source_excerpt_id` is rejected at validation.
    """

    kind: ClaimKind
    text: str
    source_excerpt_id: str | None = None
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)

    @property
    def is_grounded(self) -> bool:
        return self.kind is ClaimKind.UNKNOWN or bool(self.source_excerpt_id)


class PillOption(ApiModel):
    """An action the AI may select. Each carries an action tier (FR-07)."""

    id: str
    tier: ActionTier
    label: str
    detail: str
    expected_kwh_delta: float | None = None
    comfort_impact: str | None = None
    source_excerpt_id: str | None = None


class PillContext(ApiModel):
    """Hard-filter keys used by the transfer check (FR-09)."""

    asset_type: str
    chiller_plant: str
    tariff: str


class PillVersion(ApiModel):
    version: int
    status: PillStatus
    eval_status: EvalStatus
    eval_score: float | None = None
    context: dict[str, Any]
    triggers: list[str]
    critical_cues: list[str]
    discounted_signals: list[str]
    decision_logic: dict[str, Any]
    never_do: list[str]
    trade_offs: dict[str, Any]
    escalation: dict[str, Any]
    governance: dict[str, Any]
    claims: list[Claim] = Field(default_factory=list)
    options: list[PillOption] = Field(default_factory=list)


class PillSummary(ApiModel):
    id: str
    domain: PillDomain
    layer: str
    title: str
    status: PillStatus
    current_version: int
    owner_id: str | None = None
    reviewer_id: str | None = None
    access_class: str = "internal"


class PillDetail(PillSummary):
    context: PillContext | None = None
    triggers: list[str] = Field(default_factory=list)
    critical_cues: list[str] = Field(default_factory=list)
    discounted_signals: list[str] = Field(default_factory=list)
    never_do: list[str] = Field(default_factory=list)
    trade_offs: dict[str, Any] = Field(default_factory=dict)
    escalation: dict[str, Any] = Field(default_factory=dict)
    decision_logic: dict[str, Any] = Field(default_factory=dict)
    versions: list[PillVersion] = Field(default_factory=list)
    evidence: list[TranscriptExcerpt] = Field(default_factory=list)


class PillListResponse(ApiModel):
    count: int
    pills: list[PillSummary]


class ReviewRequest(ApiModel):
    """FR-03: a reviewer approves or rejects with a note. Authors may not approve their own pill."""

    version: int | None = Field(default=None, ge=1)
    note: str = Field(min_length=3, max_length=500)


class RollbackRequest(ApiModel):
    """FR-10: restore a superseded version."""

    target_version: int = Field(ge=1)
    note: str = Field(min_length=3, max_length=500)

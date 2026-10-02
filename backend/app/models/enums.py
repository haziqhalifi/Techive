"""Shared enums. String-valued so they serialise cleanly over JSON and match the SQL enums."""

from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    """Platform roles. Access is deny-by-default: an unknown role is rejected."""

    AOM = "aom"  # Asset Operations Manager — primary demo user
    CHIEF_ENGINEER = "chief_engineer"  # pill owner
    PILL_REVIEWER = "pill_reviewer"
    SITE_OPERATOR = "site_operator"
    GOVERNANCE_ADMIN = "governance_admin"


class ClaimKind(StrEnum):
    """Every pill claim is typed. `unknown` is the only kind allowed to lack a source."""

    FACT = "fact"
    INTERPRETATION = "interpretation"
    ACTION = "action"
    UNKNOWN = "unknown"


class ActionTier(StrEnum):
    """What the AI may do with an option."""

    RECOMMEND = "recommend"
    EXECUTE_WITH_APPROVAL = "execute_with_approval"
    ESCALATE = "escalate"


class PillStatus(StrEnum):
    DRAFT = "draft"
    IN_REVIEW = "in_review"
    APPROVED = "approved"
    SUPERSEDED = "superseded"
    ROLLED_BACK = "rolled_back"
    BLOCKED = "blocked"


class PillDomain(StrEnum):
    ENERGY = "energy"
    COMFORT = "comfort"
    TECHNICAL_SERVICES = "technical_services"


class CaseStatus(StrEnum):
    OPEN = "open"
    ESCALATED = "escalated"
    BLOCKED = "blocked"
    RESOLVED = "resolved"


class AuditAction(StrEnum):
    CAPTURE = "capture"
    VIEW = "view"
    APPLY = "apply"
    APPROVE = "approve"
    REJECT = "reject"
    ROLLBACK = "rollback"
    EXPORT = "export"
    GATE_ESCALATE = "gate_escalate"
    CONTEXT_BLOCK = "context_block"


class EvalStatus(StrEnum):
    PENDING = "pending"
    PASSED = "passed"
    FAILED = "failed"


class Route(StrEnum):
    """Graph edge keys. A router may only return one of these."""

    ESCALATE = "escalate"
    BLOCKED = "blocked"
    CONTINUE = "continue"
    OK = "ok"
    RECOMMEND = "recommend"
    EXECUTE = "execute"
    ERROR = "error"

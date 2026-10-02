"""Conflict handling across the policy hierarchy.

The higher rule always wins:

    1. Safety
    2. Statutory obligations
    3. Lease comfort terms
    4. Energy targets
    5. Preferences

Two dilemmas are settled here, deterministically, never by the model:
  - an option the pill marks as `never_do` is shown but flagged;
  - an option that raises plant energy is flagged with the amount it wastes.
"""

from __future__ import annotations

from typing import Any

POLICY_HIERARCHY: tuple[str, ...] = (
    "safety",
    "statutory",
    "lease_comfort",
    "energy_targets",
    "preferences",
)

POLICY_LABELS: dict[str, str] = {
    "safety": "Safety",
    "statutory": "Statutory obligations",
    "lease_comfort": "Lease comfort terms",
    "energy_targets": "Energy targets",
    "preferences": "Preferences",
}


def detect_conflicts(
    *,
    option: dict[str, Any],
    kwh_delta: float | None,
    pill_never_do: list[str] | None = None,
) -> str | None:
    """Return a human-readable conflict note, or None if the option is clean."""
    reasons: list[str] = []

    if str(option.get("tier")) == "escalate":
        reasons.append("Blocked by pill policy (never_do)")

    if kwh_delta is not None and kwh_delta > 0:
        reasons.append(f"Increases plant energy by {kwh_delta:.1f} kWh")

    return "; ".join(reasons) if reasons else None


def hierarchy_note() -> str:
    """Rendered on the card so the precedence is never implicit."""
    return " > ".join(POLICY_LABELS[level] for level in POLICY_HIERARCHY)

"""FR-09 — context-checked transfer.

Pure comparison, no I/O, no LLM. A pill captured for one site, plant type or tariff may
not silently apply elsewhere: any mismatch blocks the transfer until a local reviewer
signs off.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from app.models.case import ContextCheckResult

# The hard-filter keys from the pill data model.
COMPARED_KEYS: tuple[str, ...] = ("asset_type", "chiller_plant", "tariff")


def check_context(
    pill_context: Mapping[str, Any] | None,
    case_context: Mapping[str, Any] | None,
    *,
    keys: Sequence[str] = COMPARED_KEYS,
) -> ContextCheckResult:
    """Compare a pill's context against the target case context.

    A missing key on either side counts as a mismatch — if we cannot prove the contexts
    agree, we do not let the pill through.
    """
    pill_context = pill_context or {}
    case_context = case_context or {}
    mismatches: list[str] = []

    for key in keys:
        pill_value = pill_context.get(key)
        case_value = case_context.get(key)

        if pill_value is None:
            mismatches.append(f"{key}: pill does not declare this key (case={case_value!r})")
        elif case_value is None:
            mismatches.append(f"{key}: case does not declare this key (pill={pill_value!r})")
        elif str(pill_value) != str(case_value):
            mismatches.append(f"{key}: pill={pill_value!r} but case={case_value!r}")

    compatible = not mismatches
    return ContextCheckResult(
        compatible=compatible,
        mismatches=mismatches,
        requires_local_signoff=not compatible,
    )


def summarise(result: ContextCheckResult) -> str:
    if result.compatible:
        return "Context matches — the pill may be applied here."
    return (
        "Transfer blocked until a local reviewer signs off: " + "; ".join(result.mismatches) + "."
    )

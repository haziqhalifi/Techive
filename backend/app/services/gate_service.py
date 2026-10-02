"""FR-08 — the red-flag gate.

Pure rules, no I/O, no LLM. This runs FIRST in the graph, before any model call, so a
safety, odour, illness, Legionella or out-of-band-setpoint case leaves the AI path
entirely and goes straight to a human.

Target: 100% recall on the labelled eval set (backend/evals/cases/redflag_cases.jsonl).
Recall is prioritised over precision — a false escalation is cheap, a missed one is not.
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from app.models.case import GateResult

DEFAULT_COMFORT_BAND_C = (23.0, 25.0)

# rule id -> pattern. Kept in one place so the rules are auditable.
SAFETY_RULES: dict[str, re.Pattern[str]] = {
    "safety.odour": re.compile(r"\b(odou?r|smell|smells|smelly|stench|fumes)\b", re.I),
    "safety.illness": re.compile(
        r"\b(ill|illness|unwell|sick|nauseous?|dizzy|dizziness|faint|fainted|"
        r"vomit|vomiting|headache|migraine|symptom|symptoms|breathing difficulty)\b",
        re.I,
    ),
    "safety.smoke_fire": re.compile(
        r"\b(smoke|smoky|fire|burning|burnt|spark|sparks|sparking|scorch\w*)\b", re.I
    ),
    # "water" and "leak" may appear in either order ("water leaking", "leaking water").
    "safety.water_ingress": re.compile(
        r"\b(flood\w*|burst pipe|water ingress|ceiling leak)\b"
        r"|\bwater\b[^.]{0,40}?\bleak\w*"
        r"|\bleak\w*\b[^.]{0,40}?\bwater\b",
        re.I,
    ),
    "safety.gas": re.compile(
        r"\b(gas leak|gas smell|carbon monoxide|refrigerant leak|refrigerant smell)\b", re.I
    ),
}

LEGIONELLA_RULES: dict[str, re.Pattern[str]] = {
    "safety.legionella": re.compile(r"\b(legionella|legionnaires)\b", re.I),
    # "cooling tower" alone is normal; only escalate when paired with a test result.
    "safety.cooling_tower_test": re.compile(
        r"cooling[\s-]?tower.{0,80}?\b(above limit|exceeds?|exceeded|high|positive|fail\w*|cfu|bacteria)\b",
        re.I | re.S,
    ),
}

_SAFETY_REASONS = {
    "safety.odour": "Odour reported — possible air-quality or refrigerant issue.",
    "safety.illness": "Illness or symptoms reported — occupant health takes priority.",
    "safety.smoke_fire": "Smoke, fire or burning reported — emergency response required.",
    "safety.water_ingress": "Water ingress reported — electrical and slip risk.",
    "safety.gas": "Possible gas or refrigerant leak reported.",
    "safety.legionella": "Legionella named — statutory water-hygiene case.",
    "safety.cooling_tower_test": "Cooling-tower test result out of limit — statutory case.",
}


def _scan(text: str, rules: Iterable[tuple[str, re.Pattern[str]]]) -> list[str]:
    return [rule_id for rule_id, pattern in rules if pattern.search(text)]


def evaluate_gate(
    complaint_text: str,
    *,
    requested_setpoint_c: float | None = None,
    comfort_band_c: tuple[float, float] = DEFAULT_COMFORT_BAND_C,
    extra_text: str = "",
) -> GateResult:
    """Decide whether a case must bypass the AI entirely.

    Returns a GateResult with `escalate=True` and the reasons when any rule fires.
    """
    haystack = f"{complaint_text}\n{extra_text}".strip()
    matched: list[str] = []
    reasons: list[str] = []

    for rule_id in _scan(haystack, SAFETY_RULES.items()):
        matched.append(rule_id)
        reasons.append(_SAFETY_REASONS[rule_id])

    for rule_id in _scan(haystack, LEGIONELLA_RULES.items()):
        matched.append(rule_id)
        reasons.append(_SAFETY_REASONS[rule_id])

    # An out-of-band setpoint request is never an AI decision.
    low, high = comfort_band_c
    if requested_setpoint_c is not None and not (low <= requested_setpoint_c <= high):
        matched.append("safety.setpoint_out_of_band")
        reasons.append(
            f"Requested setpoint {requested_setpoint_c}°C is outside the approved band "
            f"{low}–{high}°C."
        )

    # De-duplicate while preserving order.
    matched = list(dict.fromkeys(matched))
    reasons = list(dict.fromkeys(reasons))

    return GateResult(escalate=bool(matched), reasons=reasons, matched_rules=matched)

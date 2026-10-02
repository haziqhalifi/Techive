"""FR-08 evaluation: the red-flag gate must catch 100% of must-escalate cases.

Run:
    python -m evals.redflag_eval

Exits non-zero if escalation recall drops below 100% or any benign case is escalated.
Wired into CI so a regression fails the build.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.services.gate_service import evaluate_gate

CASES_PATH = Path(__file__).resolve().parent / "cases" / "redflag_cases.jsonl"


def load_cases() -> list[dict]:
    cases: list[dict] = []
    with CASES_PATH.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if line:
                cases.append(json.loads(line))
    return cases


def run(*, verbose: bool = True) -> int:
    cases = load_cases()
    if not cases:
        print(f"no eval cases found at {CASES_PATH}")
        return 1

    true_pos = true_neg = false_pos = false_neg = 0
    failures: list[str] = []
    rows: list[str] = []

    for case in cases:
        result = evaluate_gate(case["text"], requested_setpoint_c=case.get("requested_setpoint_c"))
        expected = bool(case["must_escalate"])

        if result.escalate and expected:
            true_pos += 1
            verdict = "PASS"
        elif result.escalate and not expected:
            false_pos += 1
            verdict = "FALSE ALARM"
            failures.append(f"{case['id']}: escalated a benign case ({result.matched_rules})")
        elif not result.escalate and expected:
            false_neg += 1
            verdict = "MISSED"
            failures.append(f"{case['id']}: missed a must-escalate case")
        else:
            true_neg += 1
            verdict = "PASS"

        missing_rules = [
            rule for rule in case.get("expected_rules", []) if rule not in result.matched_rules
        ]
        if not missing_rules and verdict == "PASS" and expected:
            pass
        elif missing_rules:
            failures.append(f"{case['id']}: expected rules not matched: {missing_rules}")

        rows.append(f"  {case['id']:<6} {'escalate' if expected else 'benign  ':<9} {verdict}")

    total_positive = true_pos + false_neg
    recall = (true_pos / total_positive) if total_positive else 1.0
    specificity = (true_neg / (true_neg + false_pos)) if (true_neg + false_pos) else 1.0

    if verbose:
        print("FR-08 red-flag gate evaluation")
        print("=" * 44)
        print("\n".join(rows))
        print("-" * 44)
        print(f"  cases           : {len(cases)}")
        print(f"  escalation recall: {recall:.1%}  (target 100%)")
        print(f"  benign specificity: {specificity:.1%}")
        print(f"  missed (FN)      : {false_neg}")
        print(f"  false alarms (FP): {false_pos}")

    if failures:
        print("\nFAILURES:")
        for failure in failures:
            print(f"  - {failure}")
        print("\nRESULT: FAIL")
        return 1

    if recall < 1.0:
        print("\nRESULT: FAIL (recall below 100%)")
        return 1

    print("\nRESULT: PASS")
    return 0


if __name__ == "__main__":
    sys.exit(run())

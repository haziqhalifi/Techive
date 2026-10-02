/**
 * FR-08 — the red-flag gate. Recall is the number that matters: a miss is a safety incident.
 */

import { describe, expect, it } from "vitest";
import { evaluateGate, gateRules, SPACE_SETPOINT_BAND } from "@/modules/cases/gate.service";
import {
  GATE_NEGATIVE_FIXTURES,
  GATE_POSITIVE_FIXTURES,
} from "@/modules/synthetic/tickets.dataset";

describe("FR-08 red-flag gate", () => {
  it("catches every red-flag fixture — 100% recall", () => {
    for (const fixture of GATE_POSITIVE_FIXTURES) {
      const result = evaluateGate(fixture.text);
      expect(result.triggered, `'${fixture.text}' should have triggered`).toBe(true);
      expect(result.severity, `'${fixture.text}' severity`).toBe(fixture.severity);
      expect(result.ruleId).not.toBeNull();
      expect(result.escalateTo).not.toBeNull();
    }

    expect(GATE_POSITIVE_FIXTURES.length).toBeGreaterThanOrEqual(10);
  });

  it("does not fire on ordinary comfort and energy complaints", () => {
    for (const text of GATE_NEGATIVE_FIXTURES) {
      const result = evaluateGate(text);
      expect(result.triggered, `'${text}' should NOT have triggered (rule ${result.ruleId})`).toBe(
        false,
      );
    }
  });

  it("ignores chilled-water setpoints, which are legitimately below the space band", () => {
    const result = evaluateGate("Lower the chilled water setpoint to 6 degrees");
    expect(result.triggered).toBe(false);
  });

  it("catches an out-of-band space setpoint", () => {
    const result = evaluateGate("Please set the setpoint to 18 degrees on level 23");
    expect(result.triggered).toBe(true);
    expect(result.severity).toBe("setpoint_band");
  });

  it("prefers the most severe category when several match", () => {
    const result = evaluateGate("There is smoke and a strange smell in the corridor");
    expect(result.severity).toBe("safety");
  });

  it("treats empty input as clear rather than throwing", () => {
    expect(evaluateGate("   ").triggered).toBe(false);
  });

  it("exposes the rule set for the ops page", () => {
    const rules = gateRules();
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.every((rule) => rule.id.length > 0)).toBe(true);
  });

  it("documents the permitted space setpoint band", () => {
    expect(SPACE_SETPOINT_BAND).toEqual({ min: 22, max: 25 });
  });
});

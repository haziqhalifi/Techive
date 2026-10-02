/**
 * FR-08 — the red-flag gate.
 *
 * Runs before any model call, before any pill is selected, and before any number is shown.
 * It is pure regex plus one numeric band check: no LLM, no I/O, no ambiguity. The target is
 * 100% recall — a missed red flag is a safety incident, a false positive is only an extra
 * phone call. Every rule therefore errs toward escalating.
 */

import type { GateResult, GateSeverity } from "./case.types";

interface GateRule {
  id: string;
  severity: GateSeverity;
  pattern: RegExp;
  message: string;
}

/** Who a triggered category is handed to. Display strings, not role names. */
export const ESCALATION_TARGETS: Record<GateSeverity, string> = {
  safety: "Fire Safety Officer + Chief Engineer",
  legionella: "Water Hygiene Specialist + Chief Engineer",
  illness: "Chief Engineer + EHS Officer",
  odour: "Chief Engineer (IAQ)",
  setpoint_band: "Chief Engineer",
};

/** Permitted space setpoint band, inclusive, in °C. Chilled-water setpoints are exempt. */
export const SPACE_SETPOINT_BAND = { min: 22, max: 25 } as const;

/** Mentioning one of these means the number is plant water temperature, not a space setpoint. */
const WATER_LOOP = /\b(chilled water|chw|supply water|condenser water|secondary water|return water)\b/i;

const RULES: readonly GateRule[] = [
  {
    id: "safety.fire_smoke",
    severity: "safety",
    pattern: /\b(fire|smoke|smoking|burning|scorch\w*|sparks?|arcing|flames?)\b/i,
    message: "Possible fire or combustion indicator reported. Evacuate per site procedure and escalate immediately.",
  },
  {
    id: "safety.alarm_evacuation",
    severity: "safety",
    pattern: /\b(evacuat\w*|fire alarm|alarm panel|alarm sounder|emergency exit|sprinkler activation)\b/i,
    message: "Fire/life-safety alarm or evacuation reported. Escalate immediately.",
  },
  {
    id: "safety.gas",
    severity: "safety",
    pattern:
      /\b(gas|refrigerant|ammonia|fumes)\b[^.]{0,40}?\b(leak\w*|smell\w*|odou?r|hiss\w*|escap\w*)\b|\b(leak\w*|smell\w*|odou?r|hiss\w*)\b[^.]{0,40}?\b(gas|refrigerant|ammonia)\b/i,
    message: "Possible refrigerant or gas leak reported. Escalate immediately.",
  },
  {
    id: "safety.carbon_monoxide",
    severity: "safety",
    pattern: /\b(carbon monoxide|co detector|co alarm|co reading)\b/i,
    message: "Carbon-monoxide indicator reported. Escalate immediately.",
  },
  {
    id: "legionella.explicit",
    severity: "legionella",
    pattern: /legionell\w*|legionnaires?/i,
    message: "Legionella named in the report. Escalate to water hygiene before any plant change.",
  },
  {
    id: "legionella.aerosol",
    severity: "legionella",
    pattern:
      /\b(cooling tower|water mist|aerosol|drift eliminator|spray)\b[^.]{0,40}?\b(mist|aerosol|spray|contaminat\w*|positive|growth|biofilm)\b/i,
    message: "Aerosol-generating water system with contamination indicators. Escalate to water hygiene.",
  },
  {
    id: "illness.occupant",
    severity: "illness",
    pattern:
      /\b(dizzi\w*|nause\w*|nauseous|headache\w*|faint\w*|light[- ]?headed|short(?:ness)? of breath|breathless\w*|vomit\w*|unwell|sick)\b/i,
    message: "Occupant illness symptoms reported. Escalate to EHS; do not adjust plant.",
  },
  {
    id: "illness.staff",
    severity: "illness",
    pattern:
      /\b(staff|occupant|tenant|employee|people|team|someone|colleague|receptionist)\b[^.]{0,30}?\b(ill|sick|unwell|faint\w*|dizzy|nauseous)\b|\b(ill|sick|unwell|faint\w*|dizzy|nauseous)\b[^.]{0,30}?\b(staff|occupant|tenant|employee|people|team|someone|colleague|receptionist)\b/i,
    message: "Staff or occupants reported unwell. Escalate to EHS.",
  },
  {
    id: "odour.chemical",
    severity: "odour",
    pattern:
      /\b(damp|musty|mould\w*|mold\w*|sewage|drain|chemical|solvent|paint|exhaust|diesel)\b[^.]{0,30}?\b(smell\w*|odou?r)\b|\b(smell\w*|odou?r)\b[^.]{0,30}?\b(damp|musty|mould\w*|mold\w*|sewage|drain|chemical|solvent|paint|exhaust|diesel)\b/i,
    message: "Chemical or biological odour reported. Escalate to the chief engineer for IAQ assessment.",
  },
  {
    id: "odour.generic",
    severity: "odour",
    pattern:
      /\b(bad|strange|unusual|funny|weird|strong|foul|odd|persistent)\b[^.]{0,20}?\b(smell|odou?r)\b|\b(smell|odou?r)\b[^.]{0,20}?\b(bad|strange|unusual|funny|weird|strong|foul|odd|persistent)\b/i,
    message: "Unusual odour reported. Escalate to the chief engineer for IAQ assessment.",
  },
];

/** Read-only view of the rule set, for tests and the ops page. */
export function gateRules(): readonly { id: string; severity: GateSeverity; message: string }[] {
  return RULES.map((rule) => ({ id: rule.id, severity: rule.severity, message: rule.message }));
}

/**
 * Numeric out-of-band setpoint check.
 * A plausible space setpoint (10–35 °C) outside 22–25 °C triggers. Water-loop setpoints and
 * values outside the plausible range are ignored, so "chilled water setpoint to 6 °C" — which
 * is normal — does not fire.
 */
function evaluateSetpointBand(text: string): GateResult | null {
  if (WATER_LOOP.test(text)) return null;

  const patterns: readonly RegExp[] = [
    /\bset ?points?\b[^.]{0,40}?(\d{1,2}(?:\.\d+)?)/i,
    /\b(?:set|lower|raise|change|adjust|drop)\b[^.]{0,30}?\b(?:temperature|temp|thermostat|set ?point)\b[^.]{0,30}?\b(?:to|at)\s*(\d{1,2}(?:\.\d+)?)/i,
    /\b(?:temperature|temp|thermostat|set ?point)\b[^.]{0,30}?\b(?:set|lowered|raised|changed|adjusted|dropped)\b[^.]{0,30}?\b(?:to|at)\s*(\d{1,2}(?:\.\d+)?)/i,
    /\b(?:set|lower|raise|drop|change|adjust)\b[^.]{0,25}?\b(?:it|the (?:temperature|temp|thermostat|set ?point|air ?-? ?con|ac|a\/c))\b[^.]{0,25}?\b(?:to|at)\s*(\d{1,2}(?:\.\d+)?)/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match === null) continue;

    const value = Number.parseFloat(match[1] ?? "");
    if (!Number.isFinite(value)) continue;
    if (value >= SPACE_SETPOINT_BAND.min && value <= SPACE_SETPOINT_BAND.max) continue;
    // Outside this range it is not a plausible space setpoint (e.g. a 6 °C water setpoint).
    if (value < 10 || value > 35) continue;

    return {
      triggered: true,
      severity: "setpoint_band",
      ruleId: "setpoint.band",
      matchedText: match[0],
      escalateTo: ESCALATION_TARGETS.setpoint_band,
      message: `Requested space setpoint of ${value} °C is outside the permitted ${SPACE_SETPOINT_BAND.min}–${SPACE_SETPOINT_BAND.max} °C band.`,
    };
  }

  return null;
}

function clear(message: string): GateResult {
  return {
    triggered: false,
    severity: null,
    ruleId: null,
    matchedText: null,
    escalateTo: null,
    message,
  };
}

/**
 * Evaluate a complaint. Rule precedence: safety → legionella → illness → odour → setpoint band.
 * The first match wins, so the most severe category is always the one reported.
 */
export function evaluateGate(text: string): GateResult {
  const haystack = text.trim();
  if (haystack === "") return clear("No complaint text to evaluate.");

  for (const rule of RULES) {
    const match = rule.pattern.exec(haystack);
    if (match !== null) {
      return {
        triggered: true,
        severity: rule.severity,
        ruleId: rule.id,
        matchedText: match[0],
        escalateTo: ESCALATION_TARGETS[rule.severity],
        message: rule.message,
      };
    }
  }

  return evaluateSetpointBand(haystack) ?? clear("No red-flag rule matched.");
}

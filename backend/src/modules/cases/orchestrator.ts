/**
 * The decision pipeline.
 *
 * Node order, and why:
 *
 *   parse_case → evaluate_gate ─┬─ escalate ────────────────────────────────→ end
 *                               └─ check_context ─┬─ blocked ───────────────→ end
 *                                                 └─ select_pill
 *                                                    → validate_context ─┬─ blocked → end
 *                                                                        └─ compute_metrics
 *                                                                           → assemble_card
 *                                                                           → route_action
 *
 * The safety gate runs before retrieval and before any number is shown, so a red flag can
 * never be buried under a plausible-looking card. Metrics are computed only after the pill and
 * its context have been validated, so the card never prices an inapplicable pill.
 *
 * `recursion_limit` equivalent: `MAX_HOPS` = 10. A node that would exceed it throws rather
 * than looping.
 */

import { plantMetrics, summarise } from "@/modules/analytics/analytics.service";
import type { AssetType } from "@/modules/assets/asset.types";
import type { Asset } from "@/modules/assets/asset.types";
import { findAssetByFloor, getAsset, getSite } from "@/modules/assets/asset.repository";
import { AUDIT_ACTIONS } from "@/modules/audit/audit.types";
import { appendAudit, verifyAudit } from "@/modules/audit/audit.service";
import type { Actor } from "@/modules/governance/actor";
import { selectPill } from "@/modules/pills/orchestrator";
import { getVersion, listOptions } from "@/modules/pills/pill.repository";
import { tokenize } from "@/modules/pills/retrieval.service";
import { POLICY_TIERS } from "@/modules/pills/pill.types";
import type { ContextRequirements, PillVersion } from "@/modules/pills/pill.types";
import { PipelineError } from "@/shared/errors";
import { db, nextId } from "@/shared/store";
import { getCase, replaceDecisionOptions } from "./case.repository";
import { evaluateGate } from "./gate.service";
import type {
  Case,
  ContextCheckResult,
  ContextMismatch,
  DecisionCard,
  DecisionOption,
  Hop,
  ParsedCase,
  PipelineState,
  RouteDecision,
} from "./case.types";

/** Hard ceiling on pipeline length. Mirrors the graph's `recursion_limit`. */
export const MAX_HOPS = 10;

/** Hours the drift is sustained over when pricing the card. */
const PRICING_HOURS = 24;

interface NodeOutcome {
  note: string;
  halt?: boolean;
}

// ---------------------------------------------------------------------------
// Node: parse_case
// ---------------------------------------------------------------------------

const SYMPTOM_PATTERNS: readonly { symptom: string; pattern: RegExp }[] = [
  { symptom: "too_hot", pattern: /\b(too hot|hot|warm|overheat\w*|stuffy)\b/i },
  { symptom: "too_cold", pattern: /\b(too cold|cold|chilly|freezing|overcool\w*)\b/i },
  { symptom: "stale_air", pattern: /\b(stale|no fresh air|poor ventilation|airless|co2)\b/i },
  { symptom: "high_humidity", pattern: /\b(humid|muggy|damp|condensation|clammy)\b/i },
];

/** Deterministic extraction of the structured facts hiding in a free-text complaint. */
export function parseCase(text: string): ParsedCase {
  const floorMatch =
    /\b(?:level|floor|storey|story)\s*(\d{1,3})\b|\b(\d{1,3})(?:st|nd|rd|th)\s+floor\b/i.exec(text);
  const floorRaw = floorMatch?.[1] ?? floorMatch?.[2] ?? "";
  const floor = floorRaw === "" ? null : Number.parseInt(floorRaw, 10);

  const zoneMatch = /\bzone\s*([a-z0-9-]{1,10})\b/i.exec(text);
  const zone = zoneMatch?.[1] === undefined ? null : zoneMatch[1].toUpperCase();

  const timeMatch = /\b(\d{1,2}):(\d{2})\b/.exec(text);
  const observedAt =
    timeMatch?.[1] === undefined
      ? null
      : `${timeMatch[1].padStart(2, "0")}:${timeMatch[2] ?? "00"}`;

  const targetMatch = /\btarget(?:ed)?\s*(?:temperature\s*)?(?:of\s*)?(\d{1,2}(?:\.\d+)?)/i.exec(text);
  const targetTemperatureC =
    targetMatch?.[1] === undefined ? null : Number.parseFloat(targetMatch[1]);

  const temps = [...text.matchAll(/(\d{1,2}(?:\.\d+)?)\s*(?:°\s*c|deg(?:rees?)?\s*c|celsius)/gi)].map(
    (match) => Number.parseFloat(match[1] ?? ""),
  );
  const reportedTemperatureC =
    temps.find((value) => value !== targetTemperatureC) ?? temps[0] ?? null;

  const symptom = SYMPTOM_PATTERNS.find((entry) => entry.pattern.test(text))?.symptom ?? "unspecified";

  return {
    symptom,
    floor: floor !== null && Number.isFinite(floor) ? floor : null,
    zone,
    observedAt,
    reportedTemperatureC: Number.isFinite(reportedTemperatureC) ? reportedTemperatureC : null,
    targetTemperatureC,
    tokens: tokenize(text),
  };
}

// ---------------------------------------------------------------------------
// Node: check_context / validate_context  (FR-09)
// ---------------------------------------------------------------------------

/**
 * Compare a pill version's context requirements against the target site and asset.
 * Only the three fields named in the PRD — asset type, chiller plant, tariff — can block.
 * GFA is reported as a warning-level mismatch but is included in `mismatches` so the operator
 * sees it; it does not, on its own, need to be fatal for the demo to be honest.
 */
export function checkContext(
  version: PillVersion,
  site: { tariffSgdPerKwh: number; gfaSqm: number },
  asset: Asset | null,
): ContextCheckResult {
  const requirements: ContextRequirements = version.contextRequirements;
  const mismatches: ContextMismatch[] = [];
  const checked: string[] = [];

  checked.push("asset_type");
  if (requirements.assetTypes.length > 0) {
    const actual = asset?.assetType ?? "unknown";
    if (asset === null || !requirements.assetTypes.includes(asset.assetType as AssetType)) {
      mismatches.push({
        field: "asset_type",
        required: requirements.assetTypes.join(", "),
        actual,
        note: "The pill was captured for a different asset type.",
      });
    }
  }

  checked.push("chiller_plant");
  if (requirements.chillerPlant !== null) {
    const actual = asset?.chillerPlant ?? "unknown";
    if (actual !== requirements.chillerPlant) {
      mismatches.push({
        field: "chiller_plant",
        required: requirements.chillerPlant,
        actual,
        note: "A different chiller plant serves this asset.",
      });
    }
  }

  checked.push("tariff");
  if (requirements.tariffSgdPerKwh !== null) {
    const actual = site.tariffSgdPerKwh;
    if (Math.abs(actual - requirements.tariffSgdPerKwh) > 0.02) {
      mismatches.push({
        field: "tariff",
        required: requirements.tariffSgdPerKwh.toFixed(3),
        actual: actual.toFixed(3),
        note: "Tariff differs by more than SGD 0.02/kWh, so the priced options would not transfer.",
      });
    }
  }

  checked.push("gfa_sqm");
  if (requirements.minGfaSqm !== null && site.gfaSqm < requirements.minGfaSqm) {
    mismatches.push({
      field: "gfa_sqm",
      required: `>= ${requirements.minGfaSqm}`,
      actual: String(site.gfaSqm),
      note: "The site is below the scale at which the pill was validated.",
    });
  }

  return { compatible: mismatches.length === 0, checked, mismatches };
}

// ---------------------------------------------------------------------------
// Node helpers
// ---------------------------------------------------------------------------

async function step(
  state: PipelineState,
  node: string,
  run: () => NodeOutcome | Promise<NodeOutcome>,
): Promise<void> {
  if (state.hops.length >= MAX_HOPS) {
    throw new PipelineError(
      `Pipeline exceeded MAX_HOPS (${MAX_HOPS}) at node '${node}'.`,
      { caseId: state.caseId, hops: state.hops.map((hop) => hop.node) },
    );
  }

  const started = Date.now();
  try {
    const outcome = await run();
    const hop: Hop = {
      node,
      status: outcome.halt === true ? "halt" : "ok",
      latencyMs: Math.max(0, Date.now() - started),
      note: outcome.note,
    };
    state.hops.push(hop);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.error = message;
    state.hops.push({
      node,
      status: "halt",
      latencyMs: Math.max(0, Date.now() - started),
      note: message,
    });
    throw error;
  }
}

function resolveAsset(caseRecord: Case): Asset | null {
  if (caseRecord.assetId !== null) return getAsset(caseRecord.assetId);
  if (caseRecord.floor !== null) return findAssetByFloor(caseRecord.siteId, caseRecord.floor);
  return null;
}

/**
 * Read the route through a function call.
 *
 * The pipeline checks for `blocked` twice — once for an explicit transfer, once after the
 * selected pill's context is validated. TypeScript narrows `state.route` on the first check and
 * would then consider the second unreachable, so the read is funnelled through here.
 */
function isBlocked(state: PipelineState): boolean {
  return state.route === "blocked";
}

/**
 * Price the plant drift from the stored telemetry. Delegates to the one analytics entry point
 * so the card and the dashboard can never disagree.
 */
function metricsFor(tariffSgdPerKwh: number) {
  return plantMetrics(db().readings, tariffSgdPerKwh, PRICING_HOURS);
}

function optionsFor(caseId: string, version: PillVersion): DecisionOption[] {
  return listOptions(version.id).map((option) => ({
    id: nextId("do"),
    caseId,
    pillVersionId: version.id,
    label: option.label,
    detail: option.detail,
    actionTier: option.actionTier,
    sgdDelta: option.sgdDelta,
    policyRank: option.policyRank,
    selected: false,
  }));
}

/**
 * The policy hierarchy in action: the highest-priority (lowest rank) option that does not
 * increase cost wins. An option that raises cost is only ever chosen when nothing else exists,
 * and the card says so explicitly.
 */
export function pickRecommended(options: readonly DecisionOption[]): DecisionOption | null {
  if (options.length === 0) return null;
  const ranked = [...options].sort(
    (a, b) => a.policyRank - b.policyRank || a.sgdDelta - b.sgdDelta,
  );
  return ranked.find((option) => option.sgdDelta <= 0) ?? ranked[0] ?? null;
}

function policyNoteFor(
  options: readonly DecisionOption[],
  route: RouteDecision | null,
): string {
  if (route === null) return "No routing decision was reached.";
  if (route === "blocked") {
    return "Cross-site transfer blocked: the pill's context requirements do not match the target site.";
  }
  if (route === "escalate") {
    return "No cost-neutral or saving option exists; escalated to the pill owner rather than proposing a cost increase.";
  }

  const chosen = options.find((option) => option.selected) ?? null;
  if (chosen === null) {
    return "No approved pill matched the case, so a direct answer was given and no plant change was proposed.";
  }

  const parts = [
    `Recommended '${chosen.label}' (policy tier ${chosen.policyRank}): ` +
      (chosen.sgdDelta <= 0
        ? `SGD ${Math.abs(chosen.sgdDelta).toFixed(2)} saving.`
        : `SGD ${chosen.sgdDelta.toFixed(2)} cost increase.`),
  ];

  const conflict = options.find(
    (option) => option.sgdDelta > 0 && option.policyRank >= POLICY_TIERS.energy_target,
  );
  if (conflict !== undefined) {
    parts.push(
      `Rejected '${conflict.label}': it breaches the energy-target policy tier and would raise cost by SGD ${conflict.sgdDelta.toFixed(2)}.`,
    );
  }

  return parts.join(" ");
}

function finalise(
  state: PipelineState,
  caseRecord: Case,
  policyNote: string,
  persist: boolean,
  actor: Actor,
): DecisionCard {
  if (persist) {
    replaceDecisionOptions(caseRecord.id, state.options);
    appendAudit({
      action: AUDIT_ACTIONS.CASE_CARD_ASSEMBLED,
      entityType: "case",
      entityId: caseRecord.id,
      payload: {
        route: state.route,
        gateTriggered: state.gate?.triggered ?? false,
        selectedPillId: state.selection?.pillId ?? null,
        optionCount: state.options.length,
        hopCount: state.hops.length,
        policyNote,
      },
      actor,
    });
  }

  return {
    case: caseRecord,
    gate: state.gate,
    contextCheck: state.contextCheck,
    selection: state.selection,
    metrics: state.metrics,
    summary: state.summary,
    options: state.options,
    route: state.route,
    hops: state.hops,
    policyNote,
    auditVerified: verifyAudit().valid,
  };
}

export interface RunOptions {
  /** Write decision options and audit entries. `false` for read-only card reads. */
  persist?: boolean;
}

/**
 * Run the whole pipeline for a case.
 *
 * Deterministic and idempotent: re-running produces the same card. With `persist: false` it
 * performs no writes, which is how the read endpoint renders an existing case.
 */
export async function runCasePipeline(
  caseId: string,
  actor: Actor,
  options: RunOptions = {},
): Promise<DecisionCard> {
  const persist = options.persist ?? false;
  const caseRecord = getCase(caseId);
  const text = [caseRecord.symptom, caseRecord.description].filter(Boolean).join(". ").trim();

  const state: PipelineState = {
    caseId,
    actor,
    parsed: null,
    gate: null,
    contextCheck: null,
    selection: null,
    metrics: null,
    summary: null,
    options: [],
    route: null,
    hops: [],
    error: null,
  };

  // --- parse_case ---------------------------------------------------------
  await step(state, "parse_case", () => {
    state.parsed = parseCase(text);
    caseRecord.parsed = state.parsed;
    return {
      note: `floor=${state.parsed.floor ?? "n/a"} symptom=${state.parsed.symptom} tokens=${state.parsed.tokens.length}`,
    };
  });

  // --- evaluate_gate (FR-08) ---------------------------------------------
  await step(state, "evaluate_gate", () => {
    state.gate = evaluateGate(text);
    caseRecord.gate = state.gate;

    if (state.gate.triggered) {
      state.route = "escalate";
      caseRecord.status = "escalated";
      if (persist) {
        appendAudit({
          action: AUDIT_ACTIONS.CASE_GATE_TRIGGERED,
          entityType: "case",
          entityId: caseId,
          payload: {
            ruleId: state.gate.ruleId,
            severity: state.gate.severity,
            matchedText: state.gate.matchedText,
            escalateTo: state.gate.escalateTo,
          },
          actor,
        });
      }
      return { note: `halt: ${state.gate.ruleId ?? "gate"}`, halt: true };
    }

    return { note: "clear" };
  });

  if (state.gate?.triggered === true) {
    await step(state, "escalate", () => ({
      note: `handed to ${state.gate?.escalateTo ?? "Chief Engineer"}`,
      halt: true,
    }));

    return finalise(
      state,
      caseRecord,
      `Safety gate triggered (${state.gate?.severity ?? "red flag"}). The case was escalated to ${state.gate?.escalateTo ?? "the chief engineer"} and no pill was selected.`,
      persist,
      actor,
    );
  }

  // --- check_context (FR-09, explicit cross-site transfer) ----------------
  const site = getSite(caseRecord.siteId);
  const asset = resolveAsset(caseRecord);

  await step(state, "check_context", () => {
    if (caseRecord.transferFromPillId === null) {
      state.contextCheck = { compatible: true, checked: ["deferred:selected_pill"], mismatches: [] };
      return { note: "no transfer requested; context deferred to the selected pill" };
    }

    const sourceVersion = getVersion(caseRecord.transferFromPillId);
    const result = checkContext(sourceVersion, site, asset);
    state.contextCheck = result;
    caseRecord.contextCheck = result;

    if (!result.compatible) {
      state.route = "blocked";
      caseRecord.status = "blocked";
      if (persist) {
        appendAudit({
          action: AUDIT_ACTIONS.CASE_CONTEXT_BLOCKED,
          entityType: "case",
          entityId: caseId,
          payload: {
            phase: "transfer",
            sourcePillVersionId: sourceVersion.id,
            mismatches: result.mismatches,
          },
          actor,
        });
      }
      return { note: `halt: ${result.mismatches.map((mismatch) => mismatch.field).join(", ")}`, halt: true };
    }

    return { note: `transfer compatible on ${result.checked.join(", ")}` };
  });

  if (isBlocked(state)) {
    return finalise(
      state,
      caseRecord,
      `Cross-site transfer blocked. Mismatched fields: ${state.contextCheck?.mismatches
        .map((mismatch) => mismatch.field)
        .join(", ") ?? "unknown"}.`,
      persist,
      actor,
    );
  }

  // --- select_pill --------------------------------------------------------
  await step(state, "select_pill", async () => {
    state.selection = await selectPill(text);
    if (state.selection === null) return { note: "no approved pill matched" };

    if (persist) {
      appendAudit({
        action: AUDIT_ACTIONS.CASE_PILL_SELECTED,
        entityType: "case",
        entityId: caseId,
        payload: {
          pillId: state.selection.pillId,
          pillVersionId: state.selection.pillVersionId,
          score: state.selection.score,
          modelAssisted: state.selection.modelAssisted,
          candidates: state.selection.candidates.map((candidate) => ({
            pillId: candidate.pillId,
            score: candidate.score,
          })),
        },
        actor,
      });
    }

    return {
      note: `${state.selection.pillId} (score ${state.selection.score.toFixed(2)}${state.selection.modelAssisted ? ", model-assisted" : ""})`,
    };
  });

  // --- validate_context (FR-09, selected pill) ----------------------------
  await step(state, "validate_context", () => {
    if (state.selection === null) {
      state.contextCheck = null;
      return { note: "no pill selected; nothing to validate" };
    }

    const version = getVersion(state.selection.pillVersionId);
    const result = checkContext(version, site, asset);
    state.contextCheck = result;
    caseRecord.contextCheck = result;

    if (!result.compatible) {
      state.route = "blocked";
      caseRecord.status = "blocked";
      if (persist) {
        appendAudit({
          action: AUDIT_ACTIONS.CASE_CONTEXT_BLOCKED,
          entityType: "case",
          entityId: caseId,
          payload: {
            phase: "selection",
            pillVersionId: version.id,
            mismatches: result.mismatches,
          },
          actor,
        });
      }
      return { note: `halt: ${result.mismatches.map((mismatch) => mismatch.field).join(", ")}`, halt: true };
    }

    return { note: `compatible on ${result.checked.join(", ")}` };
  });

  if (isBlocked(state)) {
    return finalise(
      state,
      caseRecord,
      `Selected pill blocked at context validation. Mismatched fields: ${state.contextCheck?.mismatches
        .map((mismatch) => mismatch.field)
        .join(", ") ?? "unknown"}.`,
      persist,
      actor,
    );
  }

  // --- compute_metrics ----------------------------------------------------
  await step(state, "compute_metrics", () => {
    if (state.selection === null) {
      return { note: "no pill selected; metrics not applicable" };
    }

    state.metrics = metricsFor(site.tariffSgdPerKwh);
    state.summary = summarise(state.metrics);
    return { note: state.summary };
  });

  // --- assemble_card ------------------------------------------------------
  await step(state, "assemble_card", () => {
    if (state.selection === null) {
      state.options = [];
      return { note: "no pill selected; no options to price" };
    }

    const version = getVersion(state.selection.pillVersionId);
    state.options = optionsFor(caseId, version);
    return { note: `${state.options.length} priced option(s)` };
  });

  // --- route_action -------------------------------------------------------
  await step(state, "route_action", () => {
    if (state.selection === null) {
      state.route = "recommend";
      caseRecord.status = "decided";
      return { note: "direct answer: no pill matched, no action proposed" };
    }

    const chosen = pickRecommended(state.options);
    if (chosen === null) {
      state.route = "escalate";
      caseRecord.status = "escalated";
      return { note: "no priced option available; escalate to pill owner", halt: true };
    }

    state.options = state.options.map((option) => ({
      ...option,
      selected: option.id === chosen.id,
    }));
    state.route = chosen.actionTier;
    caseRecord.status = "decided";

    if (persist) {
      appendAudit({
        action: AUDIT_ACTIONS.CASE_ACTION_ROUTED,
        entityType: "case",
        entityId: caseId,
        payload: {
          optionId: chosen.id,
          label: chosen.label,
          actionTier: chosen.actionTier,
          sgdDelta: chosen.sgdDelta,
          policyRank: chosen.policyRank,
          pillVersionId: chosen.pillVersionId,
        },
        actor,
      });
    }

    return { note: `${chosen.actionTier}: ${chosen.label}` };
  });

  return finalise(state, caseRecord, policyNoteFor(state.options, state.route), persist, actor);
}

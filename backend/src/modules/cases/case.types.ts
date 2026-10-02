/**
 * Case value types.
 *
 * A Case is one comfort/energy complaint. Running it produces a DecisionCard: the gate
 * verdict, the context verdict, the chosen pill, the deterministic metrics, the priced
 * options, and the routing decision.
 */

import type { Actor } from "@/modules/governance/actor";
import type { MetricSet } from "@/modules/analytics/analytics.types";
import type { ActionTier, PillSelection } from "@/modules/pills/pill.types";

export const CASE_STATUSES = [
  "open",
  "gated",
  "blocked",
  "escalated",
  "decided",
  "closed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** FR-08 red-flag categories. */
export const GATE_SEVERITIES = [
  "safety",
  "odour",
  "illness",
  "legionella",
  "setpoint_band",
] as const;
export type GateSeverity = (typeof GATE_SEVERITIES)[number];

export interface GateResult {
  triggered: boolean;
  severity: GateSeverity | null;
  ruleId: string | null;
  matchedText: string | null;
  /** Human-readable handoff target, e.g. `Fire Safety Officer + Chief Engineer`. */
  escalateTo: string | null;
  message: string;
}

/** FR-09 — one field that failed the transfer comparison. */
export interface ContextMismatch {
  field: string;
  required: string;
  actual: string;
  note: string;
}

export interface ContextCheckResult {
  compatible: boolean;
  /** The fields that were actually compared, for transparency on the card. */
  checked: string[];
  mismatches: ContextMismatch[];
}

/** Deterministic parse of the free-text complaint. No model involved. */
export interface ParsedCase {
  symptom: string;
  floor: number | null;
  zone: string | null;
  observedAt: string | null;
  reportedTemperatureC: number | null;
  targetTemperatureC: number | null;
  tokens: string[];
}

export interface Case {
  id: string;
  siteId: string;
  assetId: string | null;
  tenantId: string | null;
  floor: number | null;
  zone: string | null;
  reportedAt: string;
  symptom: string;
  description: string;
  reportedBy: string;
  status: CaseStatus;
  /** FR-09: when set, this is a cross-site transfer of an existing pill version. */
  transferFromPillId: string | null;
  parsed: ParsedCase | null;
  gate: GateResult | null;
  contextCheck: ContextCheckResult | null;
  createdAt: string;
}

export interface DecisionOption {
  id: string;
  caseId: string;
  pillVersionId: string;
  label: string;
  detail: string;
  actionTier: ActionTier;
  sgdDelta: number;
  /** Lower is higher priority in the policy hierarchy. */
  policyRank: number;
  selected: boolean;
}

export type OutcomeVerdict = "improved" | "no_change" | "worse" | "pending";

export interface Outcome {
  id: string;
  caseId: string;
  optionId: string | null;
  decidedBy: string;
  decidedAt: string;
  verdict: OutcomeVerdict;
  comfortDeltaC: number | null;
  energyDeltaKwh: number | null;
  note: string;
}

/** One pipeline node execution. The hop log is the card's audit trail. */
export interface Hop {
  node: string;
  status: "ok" | "halt";
  latencyMs: number;
  note: string;
}

export type RouteDecision = ActionTier | "blocked";

/** The mutable state threaded through the pipeline. Mirrors the LangGraph AgentState. */
export interface PipelineState {
  caseId: string;
  actor: Actor;
  parsed: ParsedCase | null;
  gate: GateResult | null;
  contextCheck: ContextCheckResult | null;
  selection: PillSelection | null;
  metrics: MetricSet | null;
  summary: string | null;
  options: DecisionOption[];
  route: RouteDecision | null;
  hops: Hop[];
  error: string | null;
}

export interface DecisionCard {
  case: Case;
  gate: GateResult | null;
  contextCheck: ContextCheckResult | null;
  selection: PillSelection | null;
  metrics: MetricSet | null;
  summary: string | null;
  options: DecisionOption[];
  route: RouteDecision | null;
  hops: Hop[];
  /** Why the routing decision was made, in policy terms. */
  policyNote: string;
  auditVerified: boolean;
}

export interface CaseCreateInput {
  siteId: string;
  floor?: number | null;
  zone?: string | null;
  symptom: string;
  description?: string;
  reportedAt?: string;
  /** Set to attempt a cross-site transfer of an existing pill version (FR-09). */
  transferFromPillId?: string | null;
}

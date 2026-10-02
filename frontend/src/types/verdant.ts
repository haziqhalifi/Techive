/**
 * The API contract, mirrored from `backend/src`.
 *
 * These types are the wire format, not a re-modelling of it. If a field is nullable on the
 * server it is nullable here; if a union is closed there it is closed here. Keeping them in
 * lockstep is what makes the console safe to change without re-reading the backend.
 */

export const ROLES = [
  "aom",
  "chief_engineer",
  "pill_reviewer",
  "site_operator",
  "governance_admin",
] as const;
export type Role = (typeof ROLES)[number];

export const ACTION_TIERS = ["recommend", "execute_with_approval", "escalate"] as const;
export type ActionTier = (typeof ACTION_TIERS)[number];

export const PILL_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "retired",
  "superseded",
] as const;
export type PillStatus = (typeof PILL_STATUSES)[number];

export const CLAIM_KINDS = ["measured", "derived", "assumed", "unknown"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export const CASE_STATUSES = [
  "open",
  "gated",
  "blocked",
  "escalated",
  "decided",
  "closed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const ASSET_TYPES = [
  "chiller_plant",
  "ahu",
  "cooling_tower",
  "vav_box",
  "tenant_zone",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const OUTCOME_VERDICTS = ["improved", "no_change", "worse", "pending"] as const;
export type OutcomeVerdict = (typeof OUTCOME_VERDICTS)[number];

/** Policy hierarchy. Lower rank wins; comfort never outranks safety. */
export const POLICY_TIER_LABELS: Record<number, string> = {
  0: "Safety",
  1: "Statutory",
  2: "Lease comfort",
  3: "Energy target",
  4: "Preference",
};

// ---------------------------------------------------------------- reference

export interface RoleInfo {
  role: Role;
  label: string;
  description: { can: string; cannot: string };
  permissions: string[];
}

export interface Site {
  id: string;
  name: string;
  city: string;
  tariffSgdPerKwh: number;
  gfaSqm: number;
}

export interface Asset {
  id: string;
  siteId: string;
  name: string;
  assetType: AssetType;
  chillerPlant: string | null;
  floor: number | null;
  zone: string | null;
  ratedKw: number | null;
}

export interface Tenant {
  id: string;
  siteId: string;
  name: string;
  floor: number;
  leaseComfortMinC: number;
  leaseComfortMaxC: number;
  leaseHours: string;
}

// ---------------------------------------------------------------- analytics

export interface MetricSet {
  baselineKwPerRt: number;
  currentKwPerRt: number;
  driftKwPerRt: number;
  loadRt: number;
  hours: number;
  excessKw: number;
  excessKwh: number;
  excessSgd: number;
  weatherNormalisedKwh: number;
  weatherNormalisedSgd: number;
  tariffSgdPerKwh: number;
}

export interface Lever {
  id: string;
  label: string;
  kwh: number;
  sgd: number;
  note: string;
}

export interface ChillerReading {
  ts: string;
  loadRt: number;
  kwPerRt: number;
}

export interface MetricsResponse {
  metrics: MetricSet;
  summary: string;
  levers: Lever[];
  source: "telemetry" | "hero_inputs";
}

// ---------------------------------------------------------------- pills

export interface PillStep {
  order: number;
  instruction: string;
}

export interface ContextRequirements {
  assetTypes: AssetType[];
  chillerPlant: string | null;
  tariffSgdPerKwh: number | null;
  minGfaSqm: number | null;
}

export interface Pill {
  id: string;
  slug: string;
  title: string;
  domain: string;
  ownerId: string;
  originSiteId: string;
  currentVersionId: string | null;
  createdAt: string;
}

export interface PillVersion {
  id: string;
  pillId: string;
  version: number;
  status: PillStatus;
  summary: string;
  triggers: string[];
  actionTier: ActionTier;
  steps: PillStep[];
  claimIds: string[];
  contextRequirements: ContextRequirements;
  authorId: string;
  reviewerId: string | null;
  reviewNote: string | null;
  approvedAt: string | null;
  supersedesVersionId: string | null;
  createdAt: string;
}

export interface Claim {
  id: string;
  pillVersionId: string;
  kind: ClaimKind;
  text: string;
  sourceExcerptId: string | null;
  confidence: number;
}

export interface PillOption {
  id: string;
  pillVersionId: string;
  label: string;
  detail: string;
  actionTier: ActionTier;
  sgdDelta: number;
  policyRank: number;
  sourceExcerptId: string | null;
}

export interface TranscriptExcerpt {
  id: string;
  pillId: string;
  speaker: string;
  text: string;
  capturedAt: string;
  tags: string[];
  embedding: number[] | null;
}

export interface PillSummary {
  pill: Pill;
  version: PillVersion | null;
  claimCount: number;
  optionCount: number;
}

export interface PillDetail {
  pill: Pill;
  version: PillVersion | null;
  claims: Claim[];
  options: PillOption[];
  excerpts: TranscriptExcerpt[];
  history: PillVersion[];
}

export interface CandidateScore {
  pillId: string;
  pillVersionId: string;
  score: number;
  matchedTriggers: string[];
}

export interface PillSelection {
  pillId: string;
  pillVersionId: string;
  score: number;
  reason: string;
  candidates: CandidateScore[];
  modelAssisted: boolean;
}

export interface EvalCaseResult {
  caseId: string;
  expectedPillId: string;
  selectedPillId: string | null;
  hit: boolean;
}

export interface EvalReport {
  total: number;
  hits: number;
  precision: number;
  recall: number;
  results: EvalCaseResult[];
}

export interface ClaimInput {
  kind: ClaimKind;
  text: string;
  sourceQuote: string | null;
  confidence?: number;
}

export interface PillOptionInput {
  label: string;
  detail: string;
  actionTier: ActionTier;
  sgdDelta: number;
  policyRank: number;
  sourceQuote: string | null;
}

export interface CapturePayload {
  title: string;
  domain: string;
  summary: string;
  triggers: string[];
  steps: string[];
  actionTier: ActionTier;
  contextRequirements: ContextRequirements;
  claims: ClaimInput[];
  options?: PillOptionInput[];
  transcript: { speaker: string; text: string }[];
}

// ---------------------------------------------------------------- cases

export interface GateResult {
  triggered: boolean;
  severity: string | null;
  ruleId: string | null;
  matchedText: string | null;
  escalateTo: string | null;
  message: string;
}

export interface ContextMismatch {
  field: string;
  required: string;
  actual: string;
  note: string;
}

export interface ContextCheckResult {
  compatible: boolean;
  checked: string[];
  mismatches: ContextMismatch[];
}

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
  policyRank: number;
  selected: boolean;
}

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

export interface Hop {
  node: string;
  status: "ok" | "halt";
  latencyMs: number;
  note: string;
}

export type RouteDecision = ActionTier | "blocked";

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
  policyNote: string;
  auditVerified: boolean;
}

export interface CaseCreatePayload {
  siteId: string;
  floor?: number | null;
  zone?: string | null;
  symptom: string;
  description?: string;
  reportedAt?: string;
  transferFromPillId?: string | null;
}

export interface CaseDetail {
  case: Case;
  options: DecisionOption[];
  outcomes: Outcome[];
}

export interface OutcomePayload {
  optionId?: string | null;
  verdict: OutcomeVerdict;
  comfortDeltaC?: number | null;
  energyDeltaKwh?: number | null;
  note?: string;
}

// ---------------------------------------------------------------- audit

/** Mirrors the backend's audit vocabulary. A value not listed here is a bug. */
export const AUDIT_ACTIONS = {
  CASE_CREATED: "case.created",
  CASE_GATE_TRIGGERED: "case.gate_triggered",
  CASE_CONTEXT_BLOCKED: "case.context_blocked",
  CASE_PILL_SELECTED: "case.pill_selected",
  CASE_CARD_ASSEMBLED: "case.card_assembled",
  CASE_ACTION_ROUTED: "case.action_routed",
  CASE_OUTCOME_RECORDED: "case.outcome_recorded",
  PILL_CAPTURED: "pill.captured",
  PILL_REVISED: "pill.revised",
  PILL_SUBMITTED: "pill.submitted",
  PILL_APPROVED: "pill.approved",
  PILL_REJECTED: "pill.rejected",
  PILL_ROLLED_BACK: "pill.rolled_back",
  SEED_RUN: "seed.run",
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export const AUDIT_ENTITY_TYPES = ["case", "pill"] as const;
export type AuditEntityType = (typeof AUDIT_ENTITY_TYPES)[number];

export interface AuditLogEntry {
  id: string;
  seq: number;
  prevHash: string;
  hash: string;
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
  actorId: string;
  actorName: string;
  actorRole: Role;
  shortHash: string;
  shortPrevHash: string;
}

export interface AuditVerification {
  valid: boolean;
  entries: number;
  brokenAtSeq: number | null;
}

// ---------------------------------------------------------------- system

export interface Health {
  status: string;
  env: string;
  seed: number;
  llmEnabled: boolean;
}

export interface SeedStatus {
  seeded: boolean;
  seed: number;
  llmEnabled: boolean;
  counts: {
    sites: number;
    assets: number;
    tenants: number;
    users: number;
    readings: number;
    pills: number;
    cases: number;
    outcomes: number;
    auditEntries: number;
  };
}

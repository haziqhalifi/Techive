/**
 * TypeScript mirrors of the backend Pydantic models (app/models/*).
 * Keep in sync — `tsc --noEmit` catches drift at the boundary.
 */

export type Role =
  | "aom"
  | "chief_engineer"
  | "pill_reviewer"
  | "site_operator"
  | "governance_admin";

export type ClaimKind = "fact" | "interpretation" | "action" | "unknown";

export type ActionTier = "recommend" | "execute_with_approval" | "escalate";

export type PillStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "superseded"
  | "rolled_back"
  | "blocked";

export type PillDomain = "energy" | "comfort" | "technical_services";

export type CaseStatus = "open" | "escalated" | "blocked" | "resolved";

export type EvalStatus = "pending" | "passed" | "failed";

export type Route =
  | "escalate"
  | "blocked"
  | "continue"
  | "ok"
  | "recommend"
  | "execute"
  | "error";

export type AuditAction =
  | "capture"
  | "view"
  | "apply"
  | "approve"
  | "reject"
  | "rollback"
  | "export"
  | "gate_escalate"
  | "context_block";

// ---------------------------------------------------------------- health
export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  llm_enabled: boolean;
  data_notice: string;
}

// ---------------------------------------------------------------- deterministic results
export interface GateResult {
  escalate: boolean;
  reasons: string[];
  matched_rules: string[];
}

export interface ContextCheckResult {
  compatible: boolean;
  mismatches: string[];
  requires_local_signoff: boolean;
}

export interface LeverSaving {
  option_id: string;
  kwh_delta: number;
  sgd_delta: number;
}

export interface Metrics {
  baseline_kwrt: number;
  current_kwrt: number;
  drift_kwrt: number;
  drift_pct: number;
  exceeds_threshold: boolean;
  load_rt: number;
  horizon_hours: number;
  energy_price_sgd_per_kwh: number;
  excess_kw: number;
  excess_kwh: number;
  excess_sgd: number;
  weather_normalised_excess_kwh: number;
  wet_bulb_c: number | null;
  levers: LeverSaving[];
  note: string;
}

// ---------------------------------------------------------------- pills
export interface Claim {
  kind: ClaimKind;
  text: string;
  source_excerpt_id: string | null;
  confidence: number | null;
}

export interface PillOption {
  id: string;
  tier: ActionTier;
  label: string;
  detail: string;
  expected_kwh_delta: number | null;
  comfort_impact: string | null;
  source_excerpt_id: string | null;
}

export interface PillContext {
  asset_type: string;
  chiller_plant: string;
  tariff: string;
}

export interface PillVersion {
  version: number;
  status: PillStatus;
  eval_status: EvalStatus;
  eval_score: number | null;
  context: Record<string, unknown>;
  triggers: string[];
  critical_cues: string[];
  discounted_signals: string[];
  decision_logic: Record<string, unknown>;
  never_do: string[];
  trade_offs: Record<string, unknown>;
  escalation: Record<string, unknown>;
  governance: Record<string, unknown>;
  claims: Claim[];
  options: PillOption[];
}

export interface PillSummary {
  id: string;
  domain: PillDomain;
  layer: string;
  title: string;
  status: PillStatus;
  current_version: number;
  owner_id: string | null;
  reviewer_id: string | null;
  access_class: string;
}

export interface TranscriptExcerpt {
  id: string;
  interview_id: string;
  speaker: string;
  occurred_at: string;
  text: string;
}

export interface PillDetail extends PillSummary {
  context: PillContext | null;
  triggers: string[];
  critical_cues: string[];
  discounted_signals: string[];
  never_do: string[];
  trade_offs: Record<string, unknown>;
  escalation: Record<string, unknown>;
  decision_logic: Record<string, unknown>;
  versions: PillVersion[];
  evidence: TranscriptExcerpt[];
}

export interface PillListResponse {
  count: number;
  pills: PillSummary[];
}

// ---------------------------------------------------------------- cases
export interface DecisionOption {
  option_id: string;
  pill_id: string;
  pill_version: number;
  label: string;
  detail: string;
  tier: ActionTier;
  kwh_delta: number | null;
  sgd_delta: number | null;
  comfort_impact: string | null;
  renewal_flag: boolean;
  conflict: string | null;
  source_excerpt_id: string | null;
  source_excerpt: string | null;
}

export interface DecisionCard {
  case_id: string;
  site_id: string;
  level: number | null;
  tenant_id: string | null;
  tenant_name: string | null;
  reported_at: string;
  complaint_text: string;
  status: CaseStatus;
  route: Route;
  gate: GateResult;
  context_check: ContextCheckResult | null;
  metrics: Metrics | null;
  options: DecisionOption[];
  selected_pill_id: string | null;
  pill_version: number | null;
  requires_approval: boolean;
  generated_by: string;
  policy_hierarchy: string | null;
  data_notice: string;
}

export interface CaseCreate {
  site_id: string;
  asset_type: string;
  chiller_plant: string;
  tariff: string;
  tenant_id: string | null;
  level: number | null;
  reported_at: string;
  complaint_text: string;
  baseline_kwrt: number;
  current_kwrt: number;
  load_rt?: number | null;
  wet_bulb_c?: number | null;
  requested_setpoint_c?: number | null;
}

export interface CaseRecord {
  id: string;
  site_id: string;
  asset_type: string;
  chiller_plant: string;
  tariff: string;
  tenant_id: string | null;
  level: number | null;
  reported_at: string;
  complaint_text: string;
  status: CaseStatus;
  signals: Record<string, unknown> | null;
  gate: Record<string, unknown> | null;
  metrics: Record<string, unknown> | null;
}

export interface CaseListResponse {
  count: number;
  cases: CaseRecord[];
}

// ---------------------------------------------------------------- audit
export interface AuditEntry {
  seq: number;
  occurred_at: string;
  actor_id: string | null;
  actor_role: Role | null;
  action: AuditAction;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface AuditListResponse {
  count: number;
  chain_valid: boolean;
  broken_at_seq: number | null;
  entries: AuditEntry[];
}

// ---------------------------------------------------------------- errors
export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

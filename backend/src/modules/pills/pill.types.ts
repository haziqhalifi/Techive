/**
 * Intelligence Pill value types.
 *
 * A Pill is the identity of a body of expertise. A PillVersion is an immutable snapshot of
 * that expertise at a point in time, with a status. The model may only ever *choose* a
 * version by ID — it never authors, edits or scores one.
 */

import type { AssetType } from "@/modules/assets/asset.types";

/** FR-07 action tiers, ordered from safest to most autonomous. */
export const ACTION_TIERS = ["recommend", "execute_with_approval", "escalate"] as const;
export type ActionTier = (typeof ACTION_TIERS)[number];

export function isActionTier(value: unknown): value is ActionTier {
  return typeof value === "string" && (ACTION_TIERS as readonly string[]).includes(value);
}

export const PILL_STATUSES = [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "retired",
  "superseded",
] as const;
export type PillStatus = (typeof PILL_STATUSES)[number];

/** FR-02 claim kinds. Anything other than `unknown` must cite a transcript excerpt. */
export const CLAIM_KINDS = ["measured", "derived", "assumed", "unknown"] as const;
export type ClaimKind = (typeof CLAIM_KINDS)[number];

export interface PillStep {
  order: number;
  instruction: string;
}

/**
 * The fields FR-09 compares before a pill may transfer between sites. A `null` means
 * "this requirement does not constrain transfer".
 */
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
  /** The plant/system this pill governs, e.g. `chiller_plant`. */
  domain: string;
  /** The chief engineer who owns the expertise. */
  ownerId: string;
  originSiteId: string;
  currentVersionId: string | null;
  createdAt: string;
}

export interface PillVersion {
  id: string;
  pillId: string;
  /** Monotonic per pill, starting at 1. */
  version: number;
  status: PillStatus;
  summary: string;
  /** Symptoms / conditions that should retrieve this pill. */
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
  /** Required for every kind except `unknown`. */
  sourceExcerptId: string | null;
  /** 0–1. `unknown` claims carry 0. */
  confidence: number;
}

/** A priced, tiered action attached to a pill version. */
export interface PillOption {
  id: string;
  pillVersionId: string;
  label: string;
  detail: string;
  actionTier: ActionTier;
  /** Cost delta in SGD. Negative is a saving. */
  sgdDelta: number;
  /** Position in the policy hierarchy — lower wins. */
  policyRank: number;
  sourceExcerptId: string | null;
}

/** A verbatim quote from the capture interview. The provenance anchor for claims. */
export interface TranscriptExcerpt {
  id: string;
  pillId: string;
  speaker: string;
  text: string;
  capturedAt: string;
  tags: string[];
  /** 1536-dim vector when the pgvector path is active; `null` in the in-memory demo. */
  embedding: number[] | null;
}

export interface PillDetail {
  pill: Pill;
  version: PillVersion | null;
  claims: Claim[];
  options: PillOption[];
  excerpts: TranscriptExcerpt[];
  history: PillVersion[];
}

/** Library-list row: identity plus enough counts to render without a second fetch. */
export interface PillSummary {
  pill: Pill;
  version: PillVersion | null;
  claimCount: number;
  optionCount: number;
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
  /** True when the configured model made the pick; false when the fallback did. */
  modelAssisted: boolean;
}

/**
 * The policy hierarchy. When two options conflict, the lower rank wins — comfort never
 * outranks safety, and an energy target never outranks a lease term.
 */
export const POLICY_TIERS = {
  safety: 0,
  statutory: 1,
  lease_comfort: 2,
  energy_target: 3,
  preference: 4,
} as const;

export type PolicyTier = keyof typeof POLICY_TIERS;

export interface ClaimInput {
  kind: ClaimKind;
  text: string;
  /** The verbatim quote this claim rests on. Required unless `kind === "unknown"`. */
  sourceQuote: string | null;
  confidence?: number;
}

export interface PillOptionInput {
  label: string;
  detail: string;
  actionTier: ActionTier;
  /** Cost delta in SGD. Negative is a saving. */
  sgdDelta: number;
  policyRank: number;
  sourceQuote: string | null;
}

export interface PillCaptureInput {
  title: string;
  domain: string;
  summary: string;
  triggers: string[];
  steps: string[];
  actionTier: ActionTier;
  contextRequirements: ContextRequirements;
  claims: ClaimInput[];
  /** Explicit priced options. When omitted, options are derived from `steps`. */
  options?: PillOptionInput[];
  transcript: { speaker: string; text: string }[];
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
  /** hits / (number of cases where a pill was selected). */
  precision: number;
  /** hits / total. */
  recall: number;
  results: EvalCaseResult[];
}

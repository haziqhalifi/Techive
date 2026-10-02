/**
 * Case orchestration: create, read, and close out.
 *
 * The card is always produced by re-running the deterministic pipeline rather than by caching
 * a snapshot. That is deliberate — if the pill library changes, an existing case's card
 * reflects the change, and there is no second code path that could drift from the first.
 */

import { appendAudit } from "@/modules/audit/audit.service";
import { AUDIT_ACTIONS } from "@/modules/audit/audit.types";
import { findAssetByFloor, findTenantByFloor, getSite } from "@/modules/assets/asset.repository";
import type { Actor } from "@/modules/governance/actor";
import { assertCan } from "@/modules/governance/roles";
import { ValidationFailure } from "@/shared/errors";
import { db, nextId, nowIso } from "@/shared/store";
import { getCase, listCases, listDecisionOptions, listOutcomes } from "./case.repository";
import { runCasePipeline } from "./orchestrator";
import type {
  Case,
  CaseCreateInput,
  CaseStatus,
  DecisionCard,
  DecisionOption,
  Outcome,
  OutcomeVerdict,
} from "./case.types";

export interface CaseDetail {
  case: Case;
  options: DecisionOption[];
  outcomes: Outcome[];
}

/** Open a case and immediately run it. Returns the finished card. */
export async function createCase(input: CaseCreateInput, actor: Actor): Promise<DecisionCard> {
  assertCan(actor.role, "case:run");

  if (input.symptom.trim() === "") {
    throw new ValidationFailure("A case needs a symptom.");
  }

  const site = getSite(input.siteId);
  const floor = input.floor ?? null;
  const asset = floor === null ? null : findAssetByFloor(site.id, floor);
  const tenant = floor === null ? null : findTenantByFloor(site.id, floor);
  const ts = nowIso();

  const record: Case = {
    id: nextId("case"),
    siteId: site.id,
    assetId: asset?.id ?? null,
    tenantId: tenant?.id ?? null,
    floor,
    zone: input.zone ?? null,
    reportedAt: input.reportedAt ?? ts,
    symptom: input.symptom.trim(),
    description: input.description?.trim() ?? "",
    reportedBy: actor.id,
    status: "open",
    transferFromPillId: input.transferFromPillId ?? null,
    parsed: null,
    gate: null,
    contextCheck: null,
    createdAt: ts,
  };

  db().cases.push(record);

  appendAudit({
    action: AUDIT_ACTIONS.CASE_CREATED,
    entityType: "case",
    entityId: record.id,
    payload: {
      siteId: site.id,
      floor,
      zone: record.zone,
      symptom: record.symptom,
      transferFromPillId: record.transferFromPillId,
    },
    actor,
  });

  return runCasePipeline(record.id, actor, { persist: true });
}

/** Re-derive the card for an existing case without writing anything. */
export async function getCaseCard(caseId: string, actor: Actor): Promise<DecisionCard> {
  assertCan(actor.role, "case:read");
  getCase(caseId);
  return runCasePipeline(caseId, actor, { persist: false });
}

export function listCaseRecords(
  actor: Actor,
  filter: { siteId?: string; status?: CaseStatus } = {},
): Case[] {
  assertCan(actor.role, "case:read");
  return listCases(filter);
}

export function getCaseDetail(caseId: string, actor: Actor): CaseDetail {
  assertCan(actor.role, "case:read");
  return {
    case: getCase(caseId),
    options: listDecisionOptions(caseId),
    outcomes: listOutcomes(caseId),
  };
}

export interface OutcomeInput {
  optionId?: string | null;
  verdict: OutcomeVerdict;
  comfortDeltaC?: number | null;
  energyDeltaKwh?: number | null;
  note?: string;
}

/** Close the loop: record what actually happened. This is how the library learns. */
export function recordOutcome(caseId: string, input: OutcomeInput, actor: Actor): Outcome {
  assertCan(actor.role, "case:run");

  const record = getCase(caseId);

  const outcome: Outcome = {
    id: nextId("outcome"),
    caseId,
    optionId: input.optionId ?? null,
    decidedBy: actor.id,
    decidedAt: nowIso(),
    verdict: input.verdict,
    comfortDeltaC: input.comfortDeltaC ?? null,
    energyDeltaKwh: input.energyDeltaKwh ?? null,
    note: input.note?.trim() ?? "",
  };

  db().outcomes.push(outcome);
  record.status = "closed";

  appendAudit({
    action: AUDIT_ACTIONS.CASE_OUTCOME_RECORDED,
    entityType: "case",
    entityId: caseId,
    payload: {
      outcomeId: outcome.id,
      optionId: outcome.optionId,
      verdict: outcome.verdict,
      comfortDeltaC: outcome.comfortDeltaC,
      energyDeltaKwh: outcome.energyDeltaKwh,
    },
    actor,
  });

  return outcome;
}

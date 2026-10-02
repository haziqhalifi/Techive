/**
 * Case lookups and the small writes the pipeline performs. No decisions live here.
 */

import { NotFoundError } from "@/shared/errors";
import { db } from "@/shared/store";
import type { Case, CaseStatus, DecisionOption, Outcome } from "./case.types";

export function listCases(filter: { siteId?: string; status?: CaseStatus } = {}): Case[] {
  return db()
    .cases.filter(
      (record) =>
        (filter.siteId === undefined || record.siteId === filter.siteId) &&
        (filter.status === undefined || record.status === filter.status),
    )
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function getCase(id: string): Case {
  const record = db().cases.find((candidate) => candidate.id === id);
  if (!record) throw new NotFoundError("Case", id);
  return record;
}

export function listDecisionOptions(caseId: string): DecisionOption[] {
  return db()
    .decisionOptions.filter((option) => option.caseId === caseId)
    .sort((a, b) => a.policyRank - b.policyRank || a.sgdDelta - b.sgdDelta);
}

/** Replace a case's option set. Idempotent — re-running a case does not duplicate rows. */
export function replaceDecisionOptions(caseId: string, options: readonly DecisionOption[]): void {
  const store = db();
  store.decisionOptions = store.decisionOptions.filter((option) => option.caseId !== caseId);
  store.decisionOptions.push(...options);
}

export function listOutcomes(caseId: string): Outcome[] {
  return db()
    .outcomes.filter((outcome) => outcome.caseId === caseId)
    .sort((a, b) => (a.decidedAt < b.decidedAt ? -1 : a.decidedAt > b.decidedAt ? 1 : 0));
}

export function getLatestOutcome(caseId: string): Outcome | null {
  const outcomes = listOutcomes(caseId);
  return outcomes[outcomes.length - 1] ?? null;
}

export function countCases(): number {
  return db().cases.length;
}

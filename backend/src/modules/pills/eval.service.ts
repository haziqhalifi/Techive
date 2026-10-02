/**
 * The pill retrieval eval harness.
 *
 * Runs the historical ticket set through retrieval and reports precision and recall. This is
 * the regression gate for prompt/trigger changes: if a trigger edit makes the library worse at
 * finding the right pill, `npm test` fails.
 */

import { TICKETS_DATASET } from "@/modules/synthetic/tickets.dataset";
import { db } from "@/shared/store";
import { retrieveCandidates } from "./retrieval.service";
import type { EvalCaseResult, EvalReport } from "./pill.types";

function round(value: number, dp = 4): number {
  const factor = 10 ** dp;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

export function runEvalSuite(): EvalReport {
  const pillIdBySlug = new Map(db().pills.map((pill) => [pill.slug, pill.id]));

  const results: EvalCaseResult[] = TICKETS_DATASET.map((ticket) => {
    const expectedPillId = pillIdBySlug.get(ticket.expectedPillSlug) ?? ticket.expectedPillSlug;
    const candidates = retrieveCandidates(ticket.symptom, ticket.domain);
    const selectedPillId = candidates[0]?.pillId ?? null;

    return {
      caseId: ticket.id,
      expectedPillId,
      selectedPillId,
      hit: selectedPillId === expectedPillId,
    };
  });

  const hits = results.filter((result) => result.hit).length;
  const selected = results.filter((result) => result.selectedPillId !== null).length;

  return {
    total: results.length,
    hits,
    precision: selected === 0 ? 0 : round(hits / selected),
    recall: results.length === 0 ? 0 : round(hits / results.length),
    results,
  };
}

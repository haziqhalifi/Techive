/**
 * The pill half of the decision pipeline: retrieve candidates, then pick one.
 *
 * Kept separate from `cases/orchestrator.ts` so the retrieval → selection step can be tested
 * and evaluated (see `eval.service.ts`) without running a whole case.
 */

import { choosePill } from "./model";
import { retrieveCandidates } from "./retrieval.service";
import type { PillSelection } from "./pill.types";

/**
 * Select the pill that governs a case.
 * Returns `null` when no approved pill is relevant — the caller must route to a direct
 * answer, never to a guess.
 */
export async function selectPill(caseText: string, domain?: string): Promise<PillSelection | null> {
  const candidates = retrieveCandidates(caseText, domain);
  if (candidates.length === 0) return null;

  const choice = await choosePill(caseText, candidates);
  if (choice.pillVersionId === null) return null;

  const chosen =
    candidates.find((candidate) => candidate.pillVersionId === choice.pillVersionId) ??
    candidates[0]!;

  return {
    pillId: chosen.pillId,
    pillVersionId: chosen.pillVersionId,
    score: chosen.score,
    reason: choice.reason,
    candidates,
    modelAssisted: choice.modelAssisted,
  };
}

/**
 * Pill retrieval — deterministic lexical matching.
 *
 * The in-memory demo has no vector index, so retrieval is a weighted token-overlap score:
 * triggers weigh 3, the pill title weighs 2, the summary weighs 1. The score is normalised
 * against the case length so a long complaint does not inflate its match. Ties break on
 * `pillId`, which keeps the ranking stable across runs.
 *
 * Only **approved** versions are retrievable. A draft pill can never reach a decision card.
 */

import { getPillRecord, listApprovedVersions } from "./pill.repository";
import type { CandidateScore, PillVersion } from "./pill.types";

const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was",
  "one", "our", "out", "day", "get", "has", "him", "his", "how", "its", "new", "now", "old",
  "see", "two", "way", "who", "did", "this", "that", "with", "have", "from", "they", "been",
  "were", "said", "each", "she", "which", "their", "will", "other", "about", "many", "then",
  "them", "these", "some", "would", "make", "like", "into", "time", "very", "when", "come",
  "could", "than", "more", "over", "also", "just", "because", "there", "here", "what", "where",
  "level", "floor", "room", "area", "please", "need", "want", "still", "after", "before",
  "today", "reported", "issue", "problem", "complaint", "tenant", "occupant",
]);

/** Lowercase, strip punctuation, drop stopwords and short tokens. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

function round(value: number, dp = 4): number {
  const factor = 10 ** dp;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

/** Score one version against a tokenised case. Pure. */
export function scoreVersion(
  caseTokens: readonly string[],
  version: PillVersion,
  pillId: string,
  title: string,
  summary: string,
): CandidateScore {
  const caseSet = new Set(caseTokens);
  const triggerTokens = version.triggers.flatMap(tokenize);
  const titleTokens = tokenize(title);
  const summaryTokens = tokenize(summary);

  const matchedTriggers = [...new Set(triggerTokens.filter((token) => caseSet.has(token)))];

  const weighted =
    3 * triggerTokens.filter((token) => caseSet.has(token)).length +
    2 * titleTokens.filter((token) => caseSet.has(token)).length +
    1 * summaryTokens.filter((token) => caseSet.has(token)).length;

  const denominator = 3 * Math.max(1, caseSet.size);
  const score = matchedTriggers.length === 0 ? 0 : round(Math.min(1, weighted / denominator));

  return { pillId, pillVersionId: version.id, score, matchedTriggers };
}

/**
 * Rank approved pills for a case. Returns only positive scores, best first.
 * An empty result is a first-class outcome: the pipeline routes to a direct answer rather
 * than letting the model improvise.
 */
export function retrieveCandidates(caseText: string, domain?: string, limit = 5): CandidateScore[] {
  const caseTokens = tokenize(caseText);

  return listApprovedVersions(domain)
    .map((version) => {
      const pill = getPillRecord(version.pillId);
      return scoreVersion(caseTokens, version, pill.id, pill.title, version.summary);
    })
    .filter((candidate) => candidate.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || (a.pillId < b.pillId ? -1 : a.pillId > b.pillId ? 1 : 0),
    )
    .slice(0, limit);
}

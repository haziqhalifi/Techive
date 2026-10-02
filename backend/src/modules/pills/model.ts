/**
 * The model boundary — the ONLY place in this codebase that talks to an LLM provider.
 *
 * The contract is deliberately tiny: given a case and a ranked candidate list, return the ID
 * of exactly one candidate. The model does not compute numbers, does not write guidance, and
 * cannot introduce an ID that retrieval did not supply. A hallucinated or malformed response
 * falls back to the top-scoring candidate, so the pipeline is safe with the model switched on
 * or off.
 *
 * With `LLM_ENABLED=false` (the demo and CI default) this module never performs I/O.
 */

import { config } from "@/config";
import type { CandidateScore } from "./pill.types";

export interface ModelChoice {
  pillVersionId: string | null;
  reason: string;
  modelAssisted: boolean;
}

const MODEL_TIMEOUT_MS = 10_000;

function deterministicChoice(candidates: readonly CandidateScore[]): ModelChoice {
  const top = candidates[0];
  if (top === undefined) {
    return { pillVersionId: null, reason: "No approved pill matched the case.", modelAssisted: false };
  }

  return {
    pillVersionId: top.pillVersionId,
    reason: `Highest retrieval score (${top.score.toFixed(2)}); matched ${top.matchedTriggers.length} trigger token(s).`,
    modelAssisted: false,
  };
}

interface ChatCompletion {
  choices?: { message?: { content?: string | null } }[];
}

async function callModel(caseText: string, candidates: readonly CandidateScore[]): Promise<string> {
  const baseUrl =
    config.llm.baseUrl === ""
      ? "https://api.openai.com/v1"
      : config.llm.baseUrl.replace(/\/+$/, "");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.llm.apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: config.llm.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You select exactly one Intelligence Pill version ID from the supplied candidates. " +
              "You never invent IDs, never write guidance, and never produce or change numbers. " +
              'Reply with JSON only: {"pill_version_id": "<one of the candidates>", "reason": "<short reason>"}.',
          },
          {
            role: "user",
            content: JSON.stringify({
              case: caseText,
              candidates: candidates.map((candidate) => ({
                pill_version_id: candidate.pillVersionId,
                pill_id: candidate.pillId,
                score: candidate.score,
                matched_triggers: candidate.matchedTriggers,
              })),
            }),
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`Model responded with HTTP ${response.status}.`);

    const body = (await response.json()) as ChatCompletion;
    return body.choices?.[0]?.message?.content ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the model to choose a candidate. Falls back deterministically on any failure — a
 * disabled model, a timeout, a non-2xx response, or an ID outside the candidate set.
 */
export async function choosePill(
  caseText: string,
  candidates: readonly CandidateScore[],
): Promise<ModelChoice> {
  const fallback = deterministicChoice(candidates);
  if (!config.llm.enabled || config.llm.apiKey === "") return fallback;

  try {
    const content = await callModel(caseText, candidates);
    const parsed = JSON.parse(content) as { pill_version_id?: unknown; reason?: unknown };
    const allowed = new Set(candidates.map((candidate) => candidate.pillVersionId));

    if (typeof parsed.pill_version_id !== "string" || !allowed.has(parsed.pill_version_id)) {
      return fallback;
    }

    return {
      pillVersionId: parsed.pill_version_id,
      reason:
        typeof parsed.reason === "string" && parsed.reason.trim() !== ""
          ? parsed.reason
          : "Model selected a pill from the candidate set.",
      modelAssisted: true,
    };
  } catch {
    return fallback;
  }
}

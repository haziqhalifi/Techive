/**
 * Shared test fixtures. Not a test file — vitest only collects `*.test.ts`.
 */

import { actorFromRole } from "@/modules/governance/actor";
import type { Actor } from "@/modules/governance/actor";
import type { Role } from "@/modules/governance/roles";
import type { PillCaptureInput } from "@/modules/pills/pill.types";
import { runSeed } from "@/modules/synthetic/seed.controller";

/** Rebuild the world. Call in `beforeEach` so every test starts from identical state. */
export function seedWorld(): void {
  runSeed();
}

export function actorFor(role: Role, siteId: string | null = "site-towerk"): Actor {
  return actorFromRole(role, siteId);
}

/** A minimal, fully valid capture payload. Override fields to test specific failures. */
export function sampleCapture(overrides: Partial<PillCaptureInput> = {}): PillCaptureInput {
  return {
    title: "Test Pill For Governance Rules",
    domain: "chiller_plant",
    summary: "A pill used only by the test suite.",
    triggers: ["test trigger alpha"],
    steps: ["Do the thing."],
    actionTier: "recommend",
    contextRequirements: {
      assetTypes: ["chiller_plant"],
      chillerPlant: "CP-1",
      tariffSgdPerKwh: null,
      minGfaSqm: null,
    },
    claims: [
      {
        kind: "measured",
        text: "The thing was measured at 42 units.",
        sourceQuote: "we measured the thing",
        confidence: 0.9,
      },
    ],
    options: [],
    transcript: [{ speaker: "Daniel Tan", text: "We measured the thing at 42 units." }],
    ...overrides,
  };
}

/** The hero complaint, exactly as the console sends it. */
export const HERO_CASE_INPUT = {
  siteId: "site-towerk",
  floor: 23,
  zone: "North",
  symptom: "Level 23 is too hot and stuffy at 14:40",
  description:
    "Tenant reports 26.5 C against a target of 23 C. Building-wide chiller plant efficiency has drifted from 0.62 to 0.71 kW/RT over the past two weeks.",
} as const;

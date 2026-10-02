/**
 * End-to-end pipeline behaviour: the hero case, the safety gate, and FR-09 context transfer.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { getCaseCard } from "@/modules/cases/case.service";
import { createCase } from "@/modules/cases/case.service";
import { pickRecommended } from "@/modules/cases/orchestrator";
import { getPill } from "@/modules/pills/pill.service";
import { db } from "@/shared/store";
import { HERO_CASE_INPUT, actorFor, seedWorld } from "./helpers";

function pillIdBySlug(slug: string): string {
  const pill = db().pills.find((candidate) => candidate.slug === slug);
  if (pill === undefined) throw new Error(`No seeded pill with slug '${slug}'.`);
  return pill.id;
}

function approvedVersionId(pillId: string): string {
  const version = db().pillVersions.find(
    (candidate) => candidate.pillId === pillId && candidate.status === "approved",
  );
  if (version === undefined) throw new Error(`No approved version for pill '${pillId}'.`);
  return version.id;
}

describe("the hero case", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("selects the staging pill, prices the drift, and refuses the setpoint drop", async () => {
    const card = await createCase(HERO_CASE_INPUT, actorFor("aom"));

    // Gate stays clear — this is a comfort case, not a red flag.
    expect(card.gate?.triggered).toBe(false);

    // The right pill was retrieved.
    expect(card.selection?.pillId).toBe(pillIdBySlug("chiller-plant-staging-drift"));
    expect(card.selection?.modelAssisted).toBe(false);

    // Context is compatible, so the card is allowed to price the work.
    expect(card.contextCheck?.compatible).toBe(true);

    // Metrics came from telemetry, not from a hardcoded card.
    expect(card.metrics).not.toBeNull();
    expect(card.metrics!.driftKwPerRt).toBeCloseTo(0.09, 2);
    expect(card.metrics!.excessKwh).toBeGreaterThan(1700);

    // Re-sequencing wins; the building-wide setpoint drop is present but rejected.
    const chosen = card.options.find((option) => option.selected);
    expect(chosen?.label).toContain("Re-sequence");
    expect(card.route).toBe("execute_with_approval");

    const setpointOption = card.options.find((option) =>
      option.label.toLowerCase().includes("setpoint"),
    );
    expect(setpointOption).toBeDefined();
    expect(setpointOption!.selected).toBe(false);
    expect(setpointOption!.sgdDelta).toBeGreaterThan(0);

    expect(card.policyNote).toMatch(/Rejected/);
    expect(card.policyNote).toMatch(/energy-target/);

    // Every hop is recorded and the chain still verifies.
    expect(card.hops.map((hop) => hop.node)).toEqual([
      "parse_case",
      "evaluate_gate",
      "check_context",
      "select_pill",
      "validate_context",
      "compute_metrics",
      "assemble_card",
      "route_action",
    ]);
    expect(card.auditVerified).toBe(true);
  });

  it("parses the structured facts out of the free-text complaint", async () => {
    const card = await createCase(HERO_CASE_INPUT, actorFor("aom"));
    expect(card.case.parsed?.floor).toBe(23);
    expect(card.case.parsed?.observedAt).toBe("14:40");
    expect(card.case.parsed?.symptom).toBe("too_hot");
    expect(card.case.parsed?.targetTemperatureC).toBe(23);
  });

  it("does not write to the audit log when merely re-deriving a card", async () => {
    const card = await createCase(HERO_CASE_INPUT, actorFor("aom"));
    const before = db().auditLogs.length;

    const reread = await getCaseCard(card.case.id, actorFor("aom"));

    expect(db().auditLogs.length).toBe(before);
    expect(reread.route).toBe(card.route);
    expect(reread.options.find((option) => option.selected)?.label).toBe(
      card.options.find((option) => option.selected)?.label,
    );
  });
});

describe("FR-08 — the gate halts the pipeline", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("escalates a red-flag case and selects no pill at all", async () => {
    const card = await createCase(
      {
        siteId: "site-towerk",
        floor: 23,
        symptom: "There is smoke coming from the AHU on level 23",
      },
      actorFor("aom"),
    );

    expect(card.route).toBe("escalate");
    expect(card.gate?.triggered).toBe(true);
    expect(card.gate?.severity).toBe("safety");
    expect(card.gate?.escalateTo).toBeTruthy();
    expect(card.selection).toBeNull();
    expect(card.metrics).toBeNull();
    expect(card.options).toHaveLength(0);
    expect(card.case.status).toBe("escalated");

    // The pipeline stopped at the gate: no retrieval, no numbers.
    expect(card.hops.map((hop) => hop.node)).toEqual([
      "parse_case",
      "evaluate_gate",
      "escalate",
    ]);
  });
});

describe("FR-09 — context-checked transfer", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("blocks a transfer when the chiller plant, tariff and scale do not match", async () => {
    const stagingPillId = pillIdBySlug("chiller-plant-staging-drift");
    const sourceVersionId = approvedVersionId(stagingPillId);

    const card = await createCase(
      {
        siteId: "site-harbour",
        floor: 5,
        symptom: "Level 5 is too hot and stuffy",
        description: "chiller plant efficiency drift, staging sequence wrong",
        transferFromPillId: sourceVersionId,
      },
      actorFor("aom"),
    );

    expect(card.route).toBe("blocked");
    expect(card.contextCheck?.compatible).toBe(false);

    const fields = card.contextCheck?.mismatches.map((mismatch) => mismatch.field) ?? [];
    expect(fields).toContain("chiller_plant");
    expect(fields).toContain("tariff");
    expect(fields).toContain("gfa_sqm");

    // Blocked before retrieval, so no pill and no options were produced.
    expect(card.selection).toBeNull();
    expect(card.options).toHaveLength(0);
    expect(card.policyNote).toMatch(/blocked/i);
  });

  it("allows the transfer when the context matches", async () => {
    const stagingPillId = pillIdBySlug("chiller-plant-staging-drift");
    const sourceVersionId = approvedVersionId(stagingPillId);

    const card = await createCase(
      {
        siteId: "site-towerk",
        floor: 23,
        symptom: "Level 23 is too hot and stuffy",
        description: "chiller plant efficiency drift, staging sequence wrong",
        transferFromPillId: sourceVersionId,
      },
      actorFor("aom"),
    );

    expect(card.route).not.toBe("blocked");
    expect(card.contextCheck?.compatible).toBe(true);
    expect(card.hops.map((hop) => hop.node)).toContain("check_context");
  });
});

describe("policy hierarchy", () => {
  it("prefers the lowest policy rank that does not raise cost", () => {
    const chosen = pickRecommended([
      { id: "a", caseId: "c", pillVersionId: "v", label: "cheap but low priority", detail: "", actionTier: "recommend", sgdDelta: -100, policyRank: 4, selected: false },
      { id: "b", caseId: "c", pillVersionId: "v", label: "high priority saving", detail: "", actionTier: "execute_with_approval", sgdDelta: -50, policyRank: 1, selected: false },
      { id: "c", caseId: "c", pillVersionId: "v", label: "costly", detail: "", actionTier: "recommend", sgdDelta: 900, policyRank: 0, selected: false },
    ]);

    expect(chosen?.id).toBe("b");
  });

  it("falls back to the top-ranked option when every option costs money", () => {
    const chosen = pickRecommended([
      { id: "a", caseId: "c", pillVersionId: "v", label: "less bad", detail: "", actionTier: "recommend", sgdDelta: 10, policyRank: 3, selected: false },
      { id: "b", caseId: "c", pillVersionId: "v", label: "worse", detail: "", actionTier: "recommend", sgdDelta: 90, policyRank: 2, selected: false },
    ]);

    expect(chosen?.id).toBe("b");
  });

  it("returns null when there is nothing to choose", () => {
    expect(pickRecommended([])).toBeNull();
  });
});

describe("pill detail", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("exposes claims with resolvable provenance", () => {
    const detail = getPill(pillIdBySlug("chiller-plant-staging-drift"));

    expect(detail.claims.length).toBeGreaterThan(0);

    const sourced = detail.claims.filter((claim) => claim.kind !== "unknown");
    expect(sourced.length).toBeGreaterThan(0);
    for (const claim of sourced) {
      expect(claim.sourceExcerptId).not.toBeNull();
      expect(detail.excerpts.some((excerpt) => excerpt.id === claim.sourceExcerptId)).toBe(true);
    }

    const unknown = detail.claims.filter((claim) => claim.kind === "unknown");
    for (const claim of unknown) {
      expect(claim.confidence).toBe(0);
    }
  });
});

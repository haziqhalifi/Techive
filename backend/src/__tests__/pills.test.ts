/**
 * Pill governance: FR-02 provenance, FR-03 separation of duties, versioning and rollback, and
 * the retrieval eval gate.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { runEvalSuite } from "@/modules/pills/eval.service";
import { retrieveCandidates } from "@/modules/pills/retrieval.service";
import {
  approvePill,
  capturePill,
  getPill,
  listPills,
  rejectPill,
  requireVersion,
  revisePill,
  rollbackPill,
  submitForReview,
  validateClaims,
} from "@/modules/pills/pill.service";
import { db } from "@/shared/store";
import { actorFor, sampleCapture, seedWorld } from "./helpers";

describe("FR-02 — claim provenance", () => {
  it("rejects a non-unknown claim with no source quote", () => {
    expect(() => validateClaims([{ kind: "measured", text: "x", sourceQuote: null }])).toThrow(
      /must cite a source quote/,
    );
  });

  it("rejects a quote that does not appear in the transcript", () => {
    expect(() =>
      validateClaims(
        [{ kind: "measured", text: "x", sourceQuote: "a sentence nobody said" }],
        [{ speaker: "A", text: "something else entirely" }],
      ),
    ).toThrow(/does not appear/);
  });

  it("allows an unknown claim with no quote and no confidence", () => {
    expect(() =>
      validateClaims([{ kind: "unknown", text: "we do not know yet", sourceQuote: null }]),
    ).not.toThrow();
  });

  it("rejects confidence on an unknown claim", () => {
    expect(() =>
      validateClaims([
        { kind: "unknown", text: "x", sourceQuote: null, confidence: 0.5 },
      ]),
    ).toThrow(/must not assert confidence/);
  });

  it("requires at least one claim", () => {
    expect(() => validateClaims([])).toThrow(/at least one claim/);
  });

  it("rejects confidence outside 0..1", () => {
    expect(() =>
      validateClaims([{ kind: "assumed", text: "x", sourceQuote: "y", confidence: 1.5 }]),
    ).toThrow(/between 0 and 1/);
  });

  it("accepts a fully sourced capture", () => {
    const capture = sampleCapture();
    expect(() => validateClaims(capture.claims, capture.transcript)).not.toThrow();
  });
});

describe("FR-03 — separation of duties", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("forbids an author approving their own pill, even when their role permits review", () => {
    const author = actorFor("chief_engineer");
    const created = capturePill(sampleCapture(), author);
    submitForReview(created.version!.id, author);

    // The same person, wearing a reviewer hat.
    const samePersonAsReviewer = {
      ...actorFor("pill_reviewer"),
      id: author.id,
      name: author.name,
    };

    expect(() => approvePill(created.version!.id, samePersonAsReviewer)).toThrow(/FR-03/);
  });

  it("allows a different reviewer to approve", () => {
    const author = actorFor("chief_engineer");
    const created = capturePill(sampleCapture(), author);
    submitForReview(created.version!.id, author);

    const approved = approvePill(created.version!.id, actorFor("pill_reviewer"));
    expect(approved.status).toBe("approved");
    expect(approved.reviewerId).toBe(actorFor("pill_reviewer").id);
  });

  it("denies capture to a site operator", () => {
    expect(() => capturePill(sampleCapture(), actorFor("site_operator"))).toThrow(
      /may not perform/,
    );
  });

  it("denies review to a chief engineer", () => {
    const author = actorFor("chief_engineer");
    const created = capturePill(sampleCapture(), author);
    submitForReview(created.version!.id, author);
    expect(() => approvePill(created.version!.id, author)).toThrow(/may not perform/);
  });
});

describe("pill versioning and rollback", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("seeds five approved pills and one draft", () => {
    const pills = listPills();
    expect(pills).toHaveLength(6);
    expect(pills.filter((summary) => summary.version?.status === "approved")).toHaveLength(5);
    expect(pills.filter((summary) => summary.version?.status === "draft")).toHaveLength(1);
  });

  it("keeps the live version until a revision is approved, then supports rollback", () => {
    const author = actorFor("chief_engineer");
    const reviewer = actorFor("pill_reviewer");

    const created = capturePill(sampleCapture(), author);
    const pillId = created.pill.id;
    const v1 = created.version!;
    submitForReview(v1.id, author);
    approvePill(v1.id, reviewer);
    expect(getPill(pillId).version?.id).toBe(v1.id);

    const revised = revisePill(
      pillId,
      sampleCapture({ summary: "Revised summary for version two." }),
      author,
    );
    const v2 = revised.version!;
    expect(v2.version).toBe(2);
    expect(v2.status).toBe("draft");
    expect(v2.supersedesVersionId).toBe(v1.id);

    // The draft revision must NOT be live yet.
    expect(getPill(pillId).version?.id).toBe(v1.id);

    submitForReview(v2.id, author);
    approvePill(v2.id, reviewer);
    expect(getPill(pillId).version?.id).toBe(v2.id);
    expect(requireVersion(v1.id).status).toBe("superseded");

    const restored = rollbackPill(pillId, v1.id, reviewer, "Regression found in v2.");
    expect(restored.id).toBe(v1.id);
    expect(restored.status).toBe("approved");
    expect(requireVersion(v2.id).status).toBe("superseded");
    expect(getPill(pillId).version?.id).toBe(v1.id);
  });

  it("refuses a revision from someone who does not own the pill", () => {
    const author = actorFor("chief_engineer");
    const created = capturePill(sampleCapture(), author);
    const otherChief = { ...actorFor("chief_engineer"), id: "actor-other-chief" };

    expect(() => revisePill(created.pill.id, sampleCapture(), otherChief)).toThrow(/owner/);
  });

  it("rejects a version and requires a reason", () => {
    const author = actorFor("chief_engineer");
    const created = capturePill(sampleCapture(), author);
    submitForReview(created.version!.id, author);

    expect(() => rejectPill(created.version!.id, actorFor("pill_reviewer"), "   ")).toThrow(
      /must include a reason/,
    );

    const rejected = rejectPill(
      created.version!.id,
      actorFor("pill_reviewer"),
      "Triggers are too broad.",
    );
    expect(rejected.status).toBe("rejected");
  });

  it("refuses to approve a version that is still a draft", () => {
    const created = capturePill(sampleCapture(), actorFor("chief_engineer"));
    expect(() => approvePill(created.version!.id, actorFor("pill_reviewer"))).toThrow(
      /in_review/,
    );
  });
});

describe("retrieval", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("never retrieves a draft pill", () => {
    const draft = db().pills.find((pill) => pill.slug === "vav-box-reheat-valve-calibration");
    expect(draft).toBeDefined();

    const candidates = retrieveCandidates("vav reheat valve stuck zone temperature hunting");
    expect(candidates.some((candidate) => candidate.pillId === draft!.id)).toBe(false);
  });

  it("returns nothing when no approved pill is relevant", () => {
    expect(retrieveCandidates("the passenger lift is making a rattling noise")).toHaveLength(0);
  });

  it("passes the whole historical ticket set — precision and recall of 1.0", () => {
    const report = runEvalSuite();

    expect(report.total).toBe(12);
    expect(report.hits).toBe(report.total);
    expect(report.recall).toBe(1);
    expect(report.precision).toBe(1);
  });

  it("only serves a newly captured pill after it is approved", () => {
    const author = actorFor("chief_engineer");
    const created = capturePill(
      sampleCapture({
        title: "Unique Zeta Calibration Procedure",
        triggers: ["zeta calibration quirk"],
      }),
      author,
    );

    expect(retrieveCandidates("zeta calibration quirk")).toHaveLength(0);

    submitForReview(created.version!.id, author);
    approvePill(created.version!.id, actorFor("pill_reviewer"));

    expect(retrieveCandidates("zeta calibration quirk").length).toBeGreaterThan(0);
  });
});

/**
 * Determinism. The demo's credibility rests on the same seed producing the same world, and on
 * the audit chain surviving a rebuild.
 */

import { describe, expect, it } from "vitest";
import { runSeed } from "@/modules/synthetic/seed.controller";
import { verifyAudit } from "@/modules/audit/audit.service";
import { db } from "@/shared/store";

function snapshot(): string {
  const store = db();
  return JSON.stringify({
    readings: store.readings,
    pills: store.pills,
    versions: store.pillVersions,
    claims: store.claims,
    options: store.pillOptions,
    excerpts: store.transcriptExcerpts,
    audit: store.auditLogs,
  });
}

describe("determinism", () => {
  it("produces a byte-identical world for the same seed", () => {
    runSeed();
    const first = snapshot();

    runSeed();
    expect(snapshot()).toBe(first);
  });

  it("generates the full 14-day observation window", () => {
    runSeed();

    const readings = db().readings;
    expect(readings).toHaveLength(14 * 96);
    expect(readings[0]?.ts).toBe("2026-09-01T00:00:00.000Z");
    expect(readings[readings.length - 1]?.ts).toBe("2026-09-14T23:45:00.000Z");
  });

  it("keeps the audit chain valid across a rebuild", () => {
    runSeed();
    const firstLength = db().auditLogs.length;

    runSeed();

    expect(db().auditLogs).toHaveLength(firstLength);
    expect(verifyAudit().valid).toBe(true);
  });

  it("never calls Math.random — the world is reproducible from the seed alone", () => {
    runSeed();
    const readings = db().readings.map((reading) => reading.kwPerRt);

    runSeed();
    expect(db().readings.map((reading) => reading.kwPerRt)).toEqual(readings);
  });
});

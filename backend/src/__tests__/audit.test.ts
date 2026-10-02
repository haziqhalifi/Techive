/**
 * FR-11 — the audit chain. Tamper detection is the whole point: if any historical entry is
 * edited or removed, verification must fail and name the first broken sequence number.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { appendAudit, listAuditEntries, verifyAudit } from "@/modules/audit/audit.service";
import { AUDIT_ACTIONS } from "@/modules/audit/audit.types";
import { GENESIS_HASH, canonicalJson, chainHash } from "@/shared/hash";
import { db } from "@/shared/store";
import { actorFor, seedWorld } from "./helpers";

describe("FR-11 hash-chained audit log", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("verifies a freshly seeded chain", () => {
    const verification = verifyAudit();
    expect(verification.valid).toBe(true);
    expect(verification.entries).toBeGreaterThan(0);
    expect(verification.brokenAtSeq).toBeNull();
  });

  it("anchors the chain at 64 zeros", () => {
    expect(db().auditLogs[0]?.prevHash).toBe(GENESIS_HASH);
    expect(GENESIS_HASH).toHaveLength(64);
  });

  it("links every entry to its predecessor", () => {
    const log = db().auditLogs;
    expect(log.length).toBeGreaterThan(1);
    for (let index = 1; index < log.length; index += 1) {
      expect(log[index]?.prevHash).toBe(log[index - 1]?.hash);
      expect(log[index]?.seq).toBe(index + 1);
    }
  });

  it("detects an edited payload", () => {
    const entry = db().auditLogs[0];
    expect(entry).toBeDefined();
    entry!.payload = { tampered: true };

    const verification = verifyAudit();
    expect(verification.valid).toBe(false);
    expect(verification.brokenAtSeq).toBe(1);
  });

  it("detects a deleted entry", () => {
    db().auditLogs.splice(1, 1);
    expect(verifyAudit().valid).toBe(false);
  });

  it("records the pill governance trail", () => {
    const actions = listAuditEntries().map((entry) => entry.action);
    expect(actions).toContain(AUDIT_ACTIONS.PILL_CAPTURED);
    expect(actions).toContain(AUDIT_ACTIONS.PILL_SUBMITTED);
    expect(actions).toContain(AUDIT_ACTIONS.PILL_APPROVED);
    expect(actions).toContain(AUDIT_ACTIONS.SEED_RUN);
  });

  it("appends without touching history", () => {
    const before = db().auditLogs.length;
    const lastHash = db().auditLogs[before - 1]?.hash;

    appendAudit({
      action: "test.action",
      entityType: "test",
      entityId: "test-1",
      payload: { note: "appended by the test suite" },
      actor: actorFor("governance_admin"),
      occurredAt: "2026-09-15T01:00:00.000Z",
    });

    const log = db().auditLogs;
    expect(log).toHaveLength(before + 1);
    expect(log[before - 1]?.hash).toBe(lastHash);
    expect(verifyAudit().valid).toBe(true);
  });

  it("filters by entity and action", () => {
    const entries = listAuditEntries({ action: AUDIT_ACTIONS.SEED_RUN });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.entityId).toBe("seed");
  });

  it("hashes canonically, independent of key order", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));

    const fields = {
      action: "x",
      entityType: "y",
      entityId: "z",
      occurredAt: "2026-09-15T01:00:00.000Z",
    };

    expect(chainHash(GENESIS_HASH, { ...fields, payload: { p: 1, o: 2 } })).toBe(
      chainHash(GENESIS_HASH, { ...fields, payload: { o: 2, p: 1 } }),
    );
  });
});

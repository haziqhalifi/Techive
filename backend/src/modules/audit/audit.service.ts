/**
 * FR-11 — append-only, hash-chained audit log.
 *
 * Each entry commits to its predecessor's hash, so altering any historical entry breaks every
 * hash after it. There is no update or delete function, and none is exported. `verifyAudit`
 * re-derives the whole chain and reports the first sequence number that fails.
 */

import { GENESIS_HASH, chainHash, shortHash, verifyChain } from "@/shared/hash";
import { db, nextId, nowIso } from "@/shared/store";
import type { AuditAppendInput, AuditLogEntry, AuditVerification } from "./audit.types";

export interface AuditFilter {
  entityType?: string;
  entityId?: string;
  action?: string;
  actorId?: string;
  limit?: number;
}

export function listAuditEntries(filter: AuditFilter = {}): AuditLogEntry[] {
  const entries = db().auditLogs.filter(
    (entry) =>
      (filter.entityType === undefined || entry.entityType === filter.entityType) &&
      (filter.entityId === undefined || entry.entityId === filter.entityId) &&
      (filter.action === undefined || entry.action === filter.action) &&
      (filter.actorId === undefined || entry.actorId === filter.actorId),
  );

  if (filter.limit === undefined) return entries;
  // Most recent N, still returned in ascending order.
  return entries.slice(Math.max(0, entries.length - filter.limit));
}

/** Append one entry. The only way to add to the log. */
export function appendAudit(input: AuditAppendInput): AuditLogEntry {
  const log = db().auditLogs;
  const previous = log[log.length - 1];
  const seq = log.length + 1;
  const prevHash = previous === undefined ? GENESIS_HASH : previous.hash;

  const fields = {
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    payload: input.payload,
    occurredAt: input.occurredAt ?? nowIso(),
  };

  const entry: AuditLogEntry = {
    id: nextId("audit"),
    seq,
    prevHash,
    hash: chainHash(prevHash, fields),
    ...fields,
    actorId: input.actor.id,
    actorName: input.actor.name,
    actorRole: input.actor.role,
  };

  log.push(entry);
  return entry;
}

/** Re-derive the chain. Checks both the hashes and that the sequence is contiguous. */
export function verifyAudit(): AuditVerification {
  const entries = db().auditLogs;
  const chain = verifyChain(entries);

  if (!chain.valid) {
    return { valid: false, entries: entries.length, brokenAtSeq: chain.brokenAtSeq };
  }

  for (let index = 0; index < entries.length; index += 1) {
    if (entries[index]!.seq !== index + 1) {
      return { valid: false, entries: entries.length, brokenAtSeq: entries[index]!.seq };
    }
  }

  return { valid: true, entries: entries.length, brokenAtSeq: null };
}

/** Display form for the audit table. */
export function presentAuditEntry(entry: AuditLogEntry): AuditLogEntry & { shortHash: string; shortPrevHash: string } {
  return { ...entry, shortHash: shortHash(entry.hash), shortPrevHash: shortHash(entry.prevHash) };
}

export function auditCount(): number {
  return db().auditLogs.length;
}

/**
 * FR-11 — the audit hash chain maths.
 *
 *   hash = sha256(prevHash + canonicalJson(action, entityType, entityId, payload, occurredAt))
 *
 * The genesis entry uses 64 zeros. Canonical JSON sorts keys recursively so two logically
 * equal payloads always hash the same, whatever order they were built in.
 *
 * This module is pure and has no dependencies beyond node:crypto.
 */

import { createHash } from "node:crypto";

export const GENESIS_HASH = "0".repeat(64);

export interface AuditHashFields {
  action: string;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface ChainEntry extends AuditHashFields {
  seq: number;
  prevHash: string;
  hash: string;
}

/** Recursively sort object keys so hashing is order-independent. */
function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(entries.map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** The exact object the hash commits to. */
export function hashedBody(fields: AuditHashFields): Record<string, unknown> {
  return {
    action: fields.action,
    entity_type: fields.entityType,
    entity_id: fields.entityId,
    payload: fields.payload,
    occurred_at: fields.occurredAt,
  };
}

export function chainHash(prevHash: string, fields: AuditHashFields): string {
  return sha256(prevHash + canonicalJson(hashedBody(fields)));
}

export interface ChainVerification {
  valid: boolean;
  brokenAtSeq: number | null;
}

/** Verify a sequence of entries in ascending seq order. Pure. */
export function verifyChain(entries: readonly ChainEntry[]): ChainVerification {
  let prev = GENESIS_HASH;

  for (const entry of entries) {
    const expected = chainHash(prev, entry);
    if (entry.hash !== expected) {
      return { valid: false, brokenAtSeq: entry.seq };
    }
    prev = entry.hash;
  }

  return { valid: true, brokenAtSeq: null };
}

/** Short display form, e.g. `a1b2c3d4e5f6…`. */
export function shortHash(hash: string, length = 12): string {
  return hash.length <= length ? hash : `${hash.slice(0, length)}…`;
}

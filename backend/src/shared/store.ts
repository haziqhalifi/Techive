/**
 * The in-memory store.
 *
 * One process, one mutable world. Every module reads it through `db()`. `resetStore()` plus a
 * fixed seed rebuilds byte-identical state, which is what makes the demo and the test suite
 * deterministic.
 *
 * Type imports here are all `import type`, so this module has no runtime dependencies on the
 * feature modules — the dependency arrow points one way (services → store).
 */

import type { AuditLogEntry } from "@/modules/audit/audit.types";
import type { ChillerReading } from "@/modules/analytics/analytics.types";
import type { Asset, Site, Tenant } from "@/modules/assets/asset.types";
import type { Case, DecisionOption, Outcome } from "@/modules/cases/case.types";
import type { User } from "@/modules/governance/actor";
import type {
  Claim,
  Pill,
  PillOption,
  PillVersion,
  TranscriptExcerpt,
} from "@/modules/pills/pill.types";

export interface StoreState {
  sites: Site[];
  assets: Asset[];
  tenants: Tenant[];
  users: User[];
  /** Raw 15-minute chiller telemetry. The decision card is derived from this, not typed in. */
  readings: ChillerReading[];
  transcriptExcerpts: TranscriptExcerpt[];
  pills: Pill[];
  pillVersions: PillVersion[];
  claims: Claim[];
  pillOptions: PillOption[];
  cases: Case[];
  decisionOptions: DecisionOption[];
  outcomes: Outcome[];
  auditLogs: AuditLogEntry[];
  /** Monotonic counters keyed by ID prefix. */
  counters: Record<string, number>;
}

function emptyState(): StoreState {
  return {
    sites: [],
    assets: [],
    tenants: [],
    users: [],
    readings: [],
    transcriptExcerpts: [],
    pills: [],
    pillVersions: [],
    claims: [],
    pillOptions: [],
    cases: [],
    decisionOptions: [],
    outcomes: [],
    auditLogs: [],
    counters: {},
  };
}

let state: StoreState = emptyState();
let fixedClock: string | null = null;

/** The live store. Mutate the returned object's collections directly. */
export function db(): StoreState {
  return state;
}

/** Drop everything and start again. Also clears the clock override. */
export function resetStore(): void {
  state = emptyState();
  fixedClock = null;
}

/** True before any seed has run. */
export function isEmpty(): boolean {
  return state.sites.length === 0 && state.pills.length === 0;
}

/**
 * Freeze the clock. Seeds and tests call this so every generated timestamp is reproducible.
 * Pass `null` to return to wall-clock time.
 */
export function setClock(iso: string | null): void {
  fixedClock = iso;
}

export function now(): Date {
  return fixedClock === null ? new Date() : new Date(fixedClock);
}

export function nowIso(): string {
  return now().toISOString();
}

/** Deterministic, human-readable IDs: `pill-0001`, `pv-0007`, `case-0003`. */
export function nextId(prefix: string): string {
  const next = (state.counters[prefix] ?? 0) + 1;
  state.counters[prefix] = next;
  return `${prefix}-${String(next).padStart(4, "0")}`;
}

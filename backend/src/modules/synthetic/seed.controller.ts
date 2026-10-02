/**
 * Seed control.
 *
 * The world is seeded automatically on boot (`ensureSeeded`), because the role resolver needs
 * users to exist before any authenticated call can succeed — a chicken-and-egg the bootstrap
 * exception resolves. Re-seeding over a populated store is a governance action and requires
 * the `seed:run` permission.
 */

import { Router } from "express";
import { config } from "@/config";
import { appendAudit } from "@/modules/audit/audit.service";
import { AUDIT_ACTIONS } from "@/modules/audit/audit.types";
import { toActor } from "@/modules/governance/actor";
import type { Actor } from "@/modules/governance/actor";
import { assertCan } from "@/modules/governance/roles";
import { approvePill, capturePill, submitForReview } from "@/modules/pills/pill.service";
import { resolveActor } from "@/middleware/actor";
import { asyncHandler } from "@/shared/http";
import { db, isEmpty, nowIso, resetStore, setClock } from "@/shared/store";
import { PILL_CAPTURE_DATASET } from "./pills.dataset";
import {
  SEED_CLOCK,
  SITES,
  USERS,
  buildAssets,
  buildChillerReadings,
  buildTenants,
} from "./world.dataset";

export interface SeedReport {
  seededAt: string;
  sites: number;
  assets: number;
  tenants: number;
  users: number;
  readings: number;
  pills: number;
  approvedPills: number;
  draftPills: number;
  auditEntries: number;
}

function seedActor(role: "chief_engineer" | "pill_reviewer"): Actor {
  const user = db().users.find((candidate) => candidate.role === role);
  if (user === undefined) {
    throw new Error(`Seed dataset is missing a '${role}' user.`);
  }
  return toActor(user);
}

/**
 * Rebuild the world from scratch. Deterministic: same seed in, byte-identical state out.
 *
 * Pills are published through the real governance path, so FR-02 and FR-03 are exercised on
 * every seed rather than bypassed.
 */
export function runSeed(): SeedReport {
  resetStore();
  setClock(SEED_CLOCK);

  const store = db();
  store.sites.push(...SITES.map((site) => ({ ...site })));
  store.assets.push(...buildAssets());
  store.tenants.push(...buildTenants());
  store.users.push(...USERS.map((user) => ({ ...user })));
  store.readings.push(...buildChillerReadings());

  const chief = seedActor("chief_engineer");
  const reviewer = seedActor("pill_reviewer");

  let approvedPills = 0;

  for (const entry of PILL_CAPTURE_DATASET) {
    const detail = capturePill(entry.input, chief);
    const version = detail.version;
    if (version === null) continue;

    // The ticket dataset references pills by slug. A title edit that changes the slug would
    // silently break retrieval evaluation, so it fails the seed instead.
    if (detail.pill.slug !== entry.slug) {
      throw new Error(
        `Pill seed slug mismatch: declared '${entry.slug}' but the title slugifies to '${detail.pill.slug}'.`,
      );
    }

    // Draft pills stay draft on purpose — they prove retrieval only sees approved versions.
    if (!entry.publish) continue;

    submitForReview(version.id, chief);
    approvePill(version.id, reviewer, entry.reviewNote ?? "Reviewed and approved.");
    approvedPills += 1;
  }

  appendAudit({
    action: AUDIT_ACTIONS.SEED_RUN,
    entityType: "system",
    entityId: "seed",
    payload: {
      seed: config.seed,
      sites: store.sites.length,
      assets: store.assets.length,
      tenants: store.tenants.length,
      users: store.users.length,
      readings: store.readings.length,
      pills: store.pills.length,
      approvedPills,
    },
    actor: reviewer,
  });

  return {
    seededAt: nowIso(),
    sites: store.sites.length,
    assets: store.assets.length,
    tenants: store.tenants.length,
    users: store.users.length,
    readings: store.readings.length,
    pills: store.pills.length,
    approvedPills,
    draftPills: store.pills.length - approvedPills,
    auditEntries: store.auditLogs.length,
  };
}

/** Seed only when the store is empty. Called once at boot. */
export function ensureSeeded(): void {
  if (isEmpty()) runSeed();
}

export const seedController = Router();

/** POST /api/seed — rebuild the world. Governance-admin only. */
seedController.post(
  "/",
  asyncHandler((req, res) => {
    const actor = resolveActor(req);
    assertCan(actor.role, "seed:run");
    res.status(201).json(runSeed());
  }),
);

/** GET /api/seed/status — what is currently loaded. No permission needed. */
seedController.get("/status", (_req, res) => {
  const store = db();
  res.json({
    seeded: !isEmpty(),
    seed: config.seed,
    llmEnabled: config.llm.enabled,
    counts: {
      sites: store.sites.length,
      assets: store.assets.length,
      tenants: store.tenants.length,
      users: store.users.length,
      readings: store.readings.length,
      pills: store.pills.length,
      cases: store.cases.length,
      outcomes: store.outcomes.length,
      auditEntries: store.auditLogs.length,
    },
  });
});

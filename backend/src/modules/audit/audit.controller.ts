/**
 * FR-11 read API. Read-only by construction — there is no route that writes to the log.
 */

import { Router } from "express";
import { assertCan } from "@/modules/governance/roles";
import { resolveActor } from "@/middleware/actor";
import { readQueryInt, readQueryString } from "@/shared/http";
import { listAuditEntries, presentAuditEntry, verifyAudit } from "./audit.service";

export const auditController = Router();

/** GET /api/audit — the chain, newest page last, plus a live verification verdict. */
auditController.get("/", (req, res) => {
  const actor = resolveActor(req);
  assertCan(actor.role, "audit:read");

  const entries = listAuditEntries({
    entityType: readQueryString(req.query.entityType),
    entityId: readQueryString(req.query.entityId),
    action: readQueryString(req.query.action),
    actorId: readQueryString(req.query.actorId),
    limit: readQueryInt(req.query.limit, 200),
  });

  res.json({
    verification: verifyAudit(),
    entries: entries.map(presentAuditEntry),
  });
});

/** GET /api/audit/verify — just the verdict, for the ops dashboard. */
auditController.get("/verify", (req, res) => {
  const actor = resolveActor(req);
  assertCan(actor.role, "audit:read");
  res.json(verifyAudit());
});

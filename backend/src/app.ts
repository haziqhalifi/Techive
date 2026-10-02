/**
 * The composition root.
 *
 * `createApp()` is deliberately free of side effects beyond the bootstrap seed, so tests can
 * build an app, seed a fresh store, and drive it with supertest without opening a port.
 */

import cors from "cors";
import express from "express";
import { config } from "@/config";
import { errorHandler, notFoundHandler } from "@/middleware/errorHandler";
import { analyticsController } from "@/modules/analytics/analytics.controller";
import { assetController } from "@/modules/assets/asset.controller";
import { auditController } from "@/modules/audit/audit.controller";
import { caseController } from "@/modules/cases/case.controller";
import { pillController } from "@/modules/pills/pill.controller";
import {
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  permissionsFor,
} from "@/modules/governance/roles";
import { ensureSeeded, seedController } from "@/modules/synthetic/seed.controller";

export function createApp(): express.Express {
  // The role resolver needs users to exist before any request can be authenticated.
  ensureSeeded();

  const app = express();
  app.disable("x-powered-by");

  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      env: config.nodeEnv,
      seed: config.seed,
      llmEnabled: config.llm.enabled,
    });
  });

  /** The role switcher's data source: what each hat may and may not do. */
  app.get("/api/roles", (_req, res) => {
    res.json({
      roles: ROLES.map((role) => ({
        role,
        label: ROLE_LABELS[role],
        description: ROLE_DESCRIPTIONS[role],
        permissions: permissionsFor(role),
      })),
    });
  });

  app.use("/api/analytics", analyticsController);
  app.use("/api/pills", pillController);
  app.use("/api/cases", caseController);
  app.use("/api/audit", auditController);
  app.use("/api/seed", seedController);
  // Mounted last: /api/sites, /api/assets, /api/tenants.
  app.use("/api", assetController);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

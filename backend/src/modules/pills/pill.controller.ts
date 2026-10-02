/**
 * Pill REST surface — the capture interview, the review queue, and the eval report.
 */

import { Router } from "express";
import { z } from "zod";
import { assertCan } from "@/modules/governance/roles";
import { resolveActor } from "@/middleware/actor";
import { parseOrThrow } from "@/middleware/validation";
import { readQueryString } from "@/shared/http";
import { runEvalSuite } from "./eval.service";
import {
  approvePill,
  capturePill,
  getPill,
  listPills,
  rejectPill,
  revisePill,
  rollbackPill,
  submitForReview,
} from "./pill.service";
import type { PillStatus } from "./pill.types";

const ACTION_TIER = z.enum(["recommend", "execute_with_approval", "escalate"]);
const ASSET_TYPE = z.enum(["chiller_plant", "ahu", "cooling_tower", "vav_box", "tenant_zone"]);
const CLAIM_KIND = z.enum(["measured", "derived", "assumed", "unknown"]);

const captureSchema = z.object({
  title: z.string().min(3).max(200),
  domain: z.string().min(2).max(60),
  summary: z.string().min(3).max(1000),
  triggers: z.array(z.string().min(2).max(120)).min(1).max(40),
  steps: z.array(z.string().min(2).max(500)).min(1).max(40),
  actionTier: ACTION_TIER,
  contextRequirements: z.object({
    assetTypes: z.array(ASSET_TYPE).max(5),
    chillerPlant: z.string().max(20).nullable(),
    tariffSgdPerKwh: z.number().min(0).max(10).nullable(),
    minGfaSqm: z.number().min(0).max(1_000_000).nullable(),
  }),
  claims: z
    .array(
      z.object({
        kind: CLAIM_KIND,
        text: z.string().min(3).max(1000),
        sourceQuote: z.string().max(1000).nullable(),
        confidence: z.number().min(0).max(1).optional(),
      }),
    )
    .min(1)
    .max(50),
  options: z
    .array(
      z.object({
        label: z.string().min(2).max(200),
        detail: z.string().max(1000),
        actionTier: ACTION_TIER,
        sgdDelta: z.number(),
        policyRank: z.number().int().min(0).max(4),
        sourceQuote: z.string().max(1000).nullable(),
      }),
    )
    .max(20)
    .optional(),
  transcript: z
    .array(
      z.object({
        speaker: z.string().min(1).max(120),
        text: z.string().min(1).max(2000),
      }),
    )
    .min(1)
    .max(200),
});

const reviewSchema = z.object({
  note: z.string().max(2000).optional(),
});

const rejectSchema = z.object({
  note: z.string().min(3).max(2000),
});

const rollbackSchema = z.object({
  toVersionId: z.string().min(1).max(80),
  note: z.string().max(2000).optional(),
});

const PILL_STATUS_VALUES = [
  "draft",
  "in_review",
  "approved",
  "rejected",
  "retired",
  "superseded",
] as const;

export const pillController = Router();

/** GET /api/pills — the library, optionally filtered. */
pillController.get("/", (req, res) => {
  const actor = resolveActor(req);
  assertCan(actor.role, "pill:read");

  const statusRaw = readQueryString(req.query.status);
  const status =
    statusRaw !== undefined && (PILL_STATUS_VALUES as readonly string[]).includes(statusRaw)
      ? (statusRaw as PillStatus)
      : undefined;

  res.json({
    pills: listPills({ status, domain: readQueryString(req.query.domain) }),
  });
});

/** GET /api/pills/eval — retrieval precision/recall over the historical ticket set. */
pillController.get("/eval", (_req, res) => {
  res.json(runEvalSuite());
});

/** GET /api/pills/:pillId — full detail, including claims and provenance. */
pillController.get("/:pillId", (req, res) => {
  resolveActor(req);
  res.json(getPill(req.params.pillId));
});

/** POST /api/pills — capture a pill from an interview. Chief engineers only. */
pillController.post("/", (req, res) => {
  const actor = resolveActor(req);
  const input = parseOrThrow(captureSchema, req.body);
  res.status(201).json(capturePill(input, actor));
});

/**
 * POST /api/pills/:pillId/revise — create version n+1 as a draft.
 * The live version is untouched until the revision is approved.
 */
pillController.post("/:pillId/revise", (req, res) => {
  const actor = resolveActor(req);
  const input = parseOrThrow(captureSchema, req.body);
  res.status(201).json(revisePill(req.params.pillId, input, actor));
});

/** POST /api/pills/:pillVersionId/submit — draft → in_review. */
pillController.post("/:pillVersionId/submit", (req, res) => {
  const actor = resolveActor(req);
  res.json(submitForReview(req.params.pillVersionId, actor));
});

/** POST /api/pills/:pillVersionId/approve — in_review → approved. Reviewers only. */
pillController.post("/:pillVersionId/approve", (req, res) => {
  const actor = resolveActor(req);
  const { note } = parseOrThrow(reviewSchema, req.body ?? {});
  res.json(approvePill(req.params.pillVersionId, actor, note ?? ""));
});

/** POST /api/pills/:pillVersionId/reject — in_review → rejected. A reason is required. */
pillController.post("/:pillVersionId/reject", (req, res) => {
  const actor = resolveActor(req);
  const { note } = parseOrThrow(rejectSchema, req.body);
  res.json(rejectPill(req.params.pillVersionId, actor, note));
});

/** POST /api/pills/:pillId/rollback — re-activate an earlier approved version. */
pillController.post("/:pillId/rollback", (req, res) => {
  const actor = resolveActor(req);
  const { toVersionId, note } = parseOrThrow(rollbackSchema, req.body);
  res.json(rollbackPill(req.params.pillId, toVersionId, actor, note ?? ""));
});

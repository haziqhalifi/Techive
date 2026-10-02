/**
 * Case REST surface.
 *
 * `POST /api/cases` runs the whole pipeline and returns the finished card, so the console can
 * render gate, context, metrics, options and routing from a single response.
 */

import { Router } from "express";
import { z } from "zod";
import { resolveActor } from "@/middleware/actor";
import { parseOrThrow } from "@/middleware/validation";
import { asyncHandler, readQueryString } from "@/shared/http";
import {
  createCase,
  getCaseCard,
  getCaseDetail,
  listCaseRecords,
  recordOutcome,
} from "./case.service";
import type { CaseStatus } from "./case.types";

const createCaseSchema = z.object({
  siteId: z.string().min(1).max(80),
  floor: z.number().int().min(0).max(200).nullable().optional(),
  zone: z.string().min(1).max(20).nullable().optional(),
  symptom: z.string().min(3).max(500),
  description: z.string().max(4000).optional(),
  reportedAt: z.string().max(40).optional(),
  transferFromPillId: z.string().min(1).max(80).nullable().optional(),
});

const outcomeSchema = z.object({
  optionId: z.string().min(1).max(80).nullable().optional(),
  verdict: z.enum(["improved", "no_change", "worse", "pending"]),
  comfortDeltaC: z.number().min(-20).max(20).nullable().optional(),
  energyDeltaKwh: z.number().nullable().optional(),
  note: z.string().max(2000).optional(),
});

const CASE_STATUS_VALUES = [
  "open",
  "gated",
  "blocked",
  "escalated",
  "decided",
  "closed",
] as const;

export const caseController = Router();

/** GET /api/cases — list, optionally filtered. */
caseController.get("/", (req, res) => {
  const actor = resolveActor(req);
  const statusRaw = readQueryString(req.query.status);
  const status =
    statusRaw !== undefined && (CASE_STATUS_VALUES as readonly string[]).includes(statusRaw)
      ? (statusRaw as CaseStatus)
      : undefined;

  res.json({
    cases: listCaseRecords(actor, {
      siteId: readQueryString(req.query.siteId),
      status,
    }),
  });
});

/** POST /api/cases — open a case and run the pipeline. Returns the decision card. */
caseController.post(
  "/",
  asyncHandler(async (req, res) => {
    const actor = resolveActor(req);
    const input = parseOrThrow(createCaseSchema, req.body);
    res.status(201).json(await createCase(input, actor));
  }),
);

/** GET /api/cases/:caseId — re-derive and return the card. */
caseController.get(
  "/:caseId",
  asyncHandler(async (req, res) => {
    const actor = resolveActor(req);
    res.json(await getCaseCard(req.params.caseId, actor));
  }),
);

/** GET /api/cases/:caseId/detail — stored record plus options and outcomes. */
caseController.get("/:caseId/detail", (req, res) => {
  const actor = resolveActor(req);
  res.json(getCaseDetail(req.params.caseId, actor));
});

/** POST /api/cases/:caseId/outcome — close the loop. */
caseController.post("/:caseId/outcome", (req, res) => {
  const actor = resolveActor(req);
  const input = parseOrThrow(outcomeSchema, req.body);
  res.status(201).json(recordOutcome(req.params.caseId, input, actor));
});

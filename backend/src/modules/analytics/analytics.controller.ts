/**
 * Analytics REST surface. Read-only — the numbers come from `analytics.service.ts` and nowhere
 * else, so the dashboard and the decision card are always the same arithmetic.
 */

import { Router } from "express";
import { listSites } from "@/modules/assets/asset.repository";
import { readQueryInt, readQueryString } from "@/shared/http";
import { db } from "@/shared/store";
import {
  TARIFF_SGD_PER_KWH,
  heroMetrics,
  leverSavingsMap,
  plantMetrics,
  summarise,
} from "./analytics.service";

export const analyticsController = Router();

function tariffFor(siteId?: string): number {
  const sites = listSites();
  const site = siteId === undefined ? sites[0] : sites.find((candidate) => candidate.id === siteId);
  return site?.tariffSgdPerKwh ?? TARIFF_SGD_PER_KWH;
}

/** GET /api/analytics/metrics — the card's numbers, plus the priced lever menu. */
analyticsController.get("/metrics", (req, res) => {
  const tariffSgdPerKwh = tariffFor(readQueryString(req.query.siteId));
  const readings = db().readings;

  const metrics =
    readings.length === 0 ? heroMetrics(tariffSgdPerKwh) : plantMetrics(readings, tariffSgdPerKwh);

  res.json({
    metrics,
    summary: summarise(metrics),
    levers: leverSavingsMap(tariffSgdPerKwh),
    source: readings.length === 0 ? "hero_inputs" : "telemetry",
  });
});

/** GET /api/analytics/readings — the tail of the chiller time series, for the chart. */
analyticsController.get("/readings", (req, res) => {
  const limit = Math.min(Math.max(readQueryInt(req.query.limit, 336), 1), 2000);
  const all = db().readings;
  const readings = all.slice(Math.max(0, all.length - limit));

  res.json({ count: readings.length, total: all.length, readings });
});

/**
 * The analytics contract. These numbers are quoted in the PRD, so they are asserted exactly.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  HERO_CASE_METRICS,
  TARIFF_SGD_PER_KWH,
  heroMetrics,
  leverSavingsMap,
  plantMetrics,
  summarise,
  summariseReadings,
  weatherNormaliseKwh,
} from "@/modules/analytics/analytics.service";
import { db } from "@/shared/store";
import { seedWorld } from "./helpers";

describe("analytics — frozen hero numbers", () => {
  it("reproduces the PRD card exactly", () => {
    const metrics = heroMetrics();

    expect(metrics.baselineKwPerRt).toBe(0.623);
    expect(metrics.currentKwPerRt).toBe(0.713);
    expect(metrics.driftKwPerRt).toBe(0.09);
    expect(metrics.excessKw).toBe(76.5);
    expect(metrics.excessKwh).toBe(1836);
    expect(metrics.excessSgd).toBe(514.08);
    expect(metrics.weatherNormalisedKwh).toBe(1593.06);
  });

  it("prices the two decisive levers at the PRD values", () => {
    const levers = leverSavingsMap();
    const resequence = levers.find((lever) => lever.id === "resequence_chillers");
    const setpoint = levers.find((lever) => lever.id === "drop_setpoint");

    expect(resequence?.sgd).toBe(-1285.2);
    expect(setpoint?.sgd).toBe(642.6);
  });

  it("keeps the setpoint drop as the only cost-increasing lever", () => {
    const increasing = leverSavingsMap().filter((lever) => lever.sgd > 0);
    expect(increasing).toHaveLength(1);
    expect(increasing[0]?.id).toBe("drop_setpoint");
  });

  it("uses the documented tariff", () => {
    expect(TARIFF_SGD_PER_KWH).toBe(0.28);
  });

  it("normalises weather by the shoulder-month CDD ratio", () => {
    expect(weatherNormaliseKwh(1836)).toBe(1593.06);
  });

  it("summarises in one sentence ending in a full stop", () => {
    const text = summarise(heroMetrics());
    expect(text.endsWith(".")).toBe(true);
    expect(text).toContain("0.09");
  });
});

describe("analytics — derived from seeded telemetry", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("recovers the hero baseline and current efficiency from the raw series", () => {
    const summary = summariseReadings(db().readings);

    expect(summary.samples).toBe(14 * 96);
    expect(summary.baselineKwPerRt).toBeCloseTo(0.623, 3);
    expect(summary.currentKwPerRt).toBeCloseTo(0.713, 3);
    expect(summary.loadRt).toBeCloseTo(850, 0);
  });

  it("produces the same drift the frozen inputs produce", () => {
    const metrics = plantMetrics(db().readings, TARIFF_SGD_PER_KWH);
    expect(metrics.driftKwPerRt).toBeCloseTo(HERO_CASE_METRICS.currentKwPerRt - HERO_CASE_METRICS.baselineKwPerRt, 2);
    expect(metrics.excessKw).toBeCloseTo(76.5, 0);
  });

  it("falls back to the hero inputs when there is no telemetry", () => {
    const metrics = plantMetrics([], TARIFF_SGD_PER_KWH);
    expect(metrics.excessKwh).toBe(1836);
  });
});

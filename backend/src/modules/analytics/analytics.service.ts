/**
 * Pure analytics. No I/O, no model calls, no randomness.
 *
 * Every number the demo quotes comes out of this file. If a figure changes here the PRD's
 * hero card changes with it, which is the point: the card is arithmetic, not narration.
 *
 * Hero case (Tower K, Level 23, 14:40):
 *   baseline 0.6230 kW/RT → current 0.7130 kW/RT  (drift 0.0900)
 *   load 850 RT, 24 h, tariff 0.28 SGD/kWh
 *   → 76.5 kW excess · 1836.0 kWh · SGD 514.08 · weather-normalised 1593.06 kWh
 */

import type {
  ChillerReading,
  Lever,
  MetricInput,
  MetricSet,
  ReadingsSummary,
} from "./analytics.types";

/** Singapore commercial tariff used throughout the demo, in SGD per kWh. */
export const TARIFF_SGD_PER_KWH = 0.28;

/**
 * Shoulder-month weather correction. Measured window ran hotter than the seasonal norm,
 * so part of the excess is weather rather than plant degradation.
 *   factor = 15.1844 / 17.5 = 0.867680
 */
export const WEATHER_NORMALISATION = { baselineCdd: 15.1844, periodCdd: 17.5 } as const;

/** The frozen hero-case inputs. Changing these changes the demo. */
export const HERO_CASE_METRICS = {
  loadRt: 850,
  baselineKwPerRt: 0.623,
  currentKwPerRt: 0.713,
  hours: 24,
} as const;

/** Round and collapse `-0` so JSON output is stable. */
function round(value: number, dp = 2): number {
  const factor = 10 ** dp;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
}

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/** Weather-normalise an excess-kWh figure using the shoulder-month CDD ratio. */
export function weatherNormaliseKwh(excessKwh: number): number {
  const factor = WEATHER_NORMALISATION.baselineCdd / WEATHER_NORMALISATION.periodCdd;
  return round(excessKwh * factor, 2);
}

/** The one function that turns drift into money. */
export function computeMetrics(input: MetricInput): MetricSet {
  const driftKwPerRt = round(input.currentKwPerRt - input.baselineKwPerRt, 4);
  const excessKw = round(driftKwPerRt * input.loadRt, 2);
  const excessKwh = round(excessKw * input.hours, 2);
  const excessSgd = round(excessKwh * input.tariffSgdPerKwh, 2);
  const weatherNormalisedKwh = weatherNormaliseKwh(excessKwh);
  const weatherNormalisedSgd = round(weatherNormalisedKwh * input.tariffSgdPerKwh, 2);

  return {
    baselineKwPerRt: round(input.baselineKwPerRt, 4),
    currentKwPerRt: round(input.currentKwPerRt, 4),
    driftKwPerRt,
    loadRt: round(input.loadRt, 2),
    hours: input.hours,
    excessKw,
    excessKwh,
    excessSgd,
    weatherNormalisedKwh,
    weatherNormalisedSgd,
    tariffSgdPerKwh: round(input.tariffSgdPerKwh, 4),
  };
}

/** Convenience wrapper for the frozen hero numbers. */
export function heroMetrics(tariffSgdPerKwh = TARIFF_SGD_PER_KWH): MetricSet {
  return computeMetrics({ ...HERO_CASE_METRICS, tariffSgdPerKwh });
}

/**
 * Derive baseline / current efficiency from a reading series.
 * Baseline is the first day, current is the last day, load is the whole-window mean.
 */
export function summariseReadings(
  readings: readonly ChillerReading[],
  perDay = 96,
): ReadingsSummary {
  if (readings.length === 0) {
    return { baselineKwPerRt: 0, currentKwPerRt: 0, loadRt: 0, samples: 0 };
  }

  const baselineWindow = readings.slice(0, Math.min(perDay, readings.length));
  const currentWindow = readings.slice(Math.max(0, readings.length - perDay));

  return {
    baselineKwPerRt: round(mean(baselineWindow.map((reading) => reading.kwPerRt)), 4),
    currentKwPerRt: round(mean(currentWindow.map((reading) => reading.kwPerRt)), 4),
    loadRt: round(mean(readings.map((reading) => reading.loadRt)), 2),
    samples: readings.length,
  };
}

/**
 * The single entry point for "what is the plant costing us right now".
 *
 * Reads from telemetry when it exists and falls back to the frozen hero inputs otherwise, so
 * the card is always populated. Both the decision pipeline and the dashboard call this — there
 * is no second implementation to drift out of sync.
 */
export function plantMetrics(
  readings: readonly ChillerReading[],
  tariffSgdPerKwh: number,
  hours = 24,
): MetricSet {
  if (readings.length === 0) {
    return computeMetrics({ ...HERO_CASE_METRICS, tariffSgdPerKwh, hours });
  }

  const summary = summariseReadings(readings);
  return computeMetrics({
    baselineKwPerRt: summary.baselineKwPerRt,
    currentKwPerRt: summary.currentKwPerRt,
    loadRt: summary.loadRt,
    tariffSgdPerKwh,
    hours,
  });
}

/**
 * The priced intervention menu. `sgd` is a cost delta: negative saves money.
 * Re-sequencing staging beats dropping the setpoint — that inversion is the whole point of
 * the demo, because dropping the setpoint is the intuitive-but-wrong move.
 */
export function leverSavingsMap(tariffSgdPerKwh = TARIFF_SGD_PER_KWH): Lever[] {
  const priced = (kwh: number): number => round(kwh * tariffSgdPerKwh, 2);

  return [
    {
      id: "resequence_chillers",
      label: "Re-sequence chiller staging (lead/lag rotation)",
      kwh: -4590,
      sgd: priced(-4590),
      note: "Restores the staging order; recovers most of the drift without touching comfort.",
    },
    {
      id: "clean_condenser_tubes",
      label: "Clean condenser tubes on the lag chiller",
      kwh: -1800,
      sgd: priced(-1800),
      note: "Fouling is the likely root cause; cleaning is the durable fix.",
    },
    {
      id: "night_purge",
      label: "Night purge via AHU economiser cycle",
      kwh: -900,
      sgd: priced(-900),
      note: "Free cooling between 01:00 and 05:00; comfort-neutral.",
    },
    {
      id: "drop_setpoint",
      label: "Drop building-wide chilled-water setpoint to 6.0 °C",
      kwh: 2295,
      sgd: priced(2295),
      note: "Masks the symptom and raises energy cost. Violates the energy policy tier.",
    },
  ];
}

/** One-line, UI-ready summary. Always ends in a full stop. */
export function summarise(metrics: MetricSet): string {
  const direction = metrics.driftKwPerRt >= 0 ? "up" : "down";
  return (
    `Chiller efficiency drifted ${direction} ${Math.abs(metrics.driftKwPerRt).toFixed(2)} kW/RT ` +
    `(from ${metrics.baselineKwPerRt.toFixed(2)} to ${metrics.currentKwPerRt.toFixed(2)}), ` +
    `costing ${metrics.excessKwh.toFixed(1)} kWh and SGD ${metrics.excessSgd.toFixed(2)} ` +
    `over ${metrics.hours} h.`
  );
}

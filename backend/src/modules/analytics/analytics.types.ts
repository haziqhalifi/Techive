/**
 * Analytics value types.
 *
 * These numbers are the decision card's spine. They are computed here, never by a model.
 * `MetricSet` is what the UI renders; `Lever` is what the option table prices.
 */

/** One 15-minute chiller-plant efficiency reading. */
export interface ChillerReading {
  /** ISO-8601 timestamp. */
  ts: string;
  /** Plant load in refrigeration tons. */
  loadRt: number;
  /** Plant efficiency in kW per refrigeration ton — the number that drifts. */
  kwPerRt: number;
}

/** The inputs `computeMetrics` needs. Everything is explicit — no hidden globals. */
export interface MetricInput {
  baselineKwPerRt: number;
  currentKwPerRt: number;
  loadRt: number;
  tariffSgdPerKwh: number;
  /** Number of hours the drift is sustained over. */
  hours: number;
}

/** The full computed card payload. All monetary values are SGD. */
export interface MetricSet {
  baselineKwPerRt: number;
  currentKwPerRt: number;
  /** current − baseline. The headline number. */
  driftKwPerRt: number;
  loadRt: number;
  hours: number;
  /** drift × load — instantaneous waste. */
  excessKw: number;
  /** excessKw × hours — energy waste over the window. */
  excessKwh: number;
  /** excessKwh × tariff. */
  excessSgd: number;
  /** Weather-corrected excess — what the waste would have been in a normal month. */
  weatherNormalisedKwh: number;
  weatherNormalisedSgd: number;
  tariffSgdPerKwh: number;
}

/** A priced intervention. Negative kWh / SGD is a saving. */
export interface Lever {
  id: string;
  label: string;
  kwh: number;
  sgd: number;
  note: string;
}

/** Derived from a raw reading series, so the card can be reproduced from telemetry alone. */
export interface ReadingsSummary {
  baselineKwPerRt: number;
  currentKwPerRt: number;
  loadRt: number;
  samples: number;
}

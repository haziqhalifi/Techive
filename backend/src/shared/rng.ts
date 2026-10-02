/**
 * Deterministic pseudo-random generator.
 *
 * The whole synthetic world is built from one seed, so every run produces byte-identical
 * data and every number on the decision card is reproducible. `Math.random` is never used
 * anywhere in this codebase.
 */

/** mulberry32 — small, fast, and stable across platforms. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  /** Uniform in [0, 1). */
  float(): number {
    return this.next();
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /** Approximately normal, via Box–Muller. */
  gauss(mean = 0, standardDeviation = 1): number {
    const u = Math.max(this.next(), Number.EPSILON);
    const v = this.next();
    return mean + standardDeviation * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty collection");
    return items[this.int(0, items.length - 1)]!;
  }

  /** Round to `dp` decimal places (avoids float dust in generated data). */
  round(value: number, dp = 2): number {
    const factor = 10 ** dp;
    return Math.round(value * factor) / factor;
  }
}

export const DEFAULT_SEED = 20261002;

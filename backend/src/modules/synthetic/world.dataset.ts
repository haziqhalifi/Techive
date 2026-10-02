/**
 * The synthetic world: three sites, their plant, their leases, and 14 days of chiller
 * telemetry. Everything here is a pure function of `config.seed`, so the same seed produces
 * byte-identical data on every machine and in CI.
 *
 * The telemetry is generated to a target: day 1 averages 0.6230 kW/RT, day 14 averages
 * 0.7130 kW/RT. `analytics.summariseReadings` recovers those numbers, and the decision card
 * prices them — so the hero figures on the card are derived from the data, never typed in.
 */

import { config } from "@/config";
import type { ChillerReading } from "@/modules/analytics/analytics.types";
import type { Asset, Site, Tenant } from "@/modules/assets/asset.types";
import type { User } from "@/modules/governance/actor";
import { Rng } from "@/shared/rng";

/** The clock is frozen here during seeding so every timestamp is reproducible. */
export const SEED_CLOCK = "2026-09-15T01:00:00.000Z";

export const TOWER_K = "site-towerk";
export const HARBOUR_ONE = "site-harbour";
export const KL_SENTRAL = "site-klsentral";

export const SITES: readonly Site[] = [
  {
    id: TOWER_K,
    name: "Tower K",
    city: "Singapore",
    tariffSgdPerKwh: 0.28,
    gfaSqm: 42000,
  },
  {
    id: HARBOUR_ONE,
    name: "Harbourfront One",
    city: "Singapore",
    tariffSgdPerKwh: 0.31,
    gfaSqm: 28000,
  },
  {
    id: KL_SENTRAL,
    name: "KL Sentral Annex",
    city: "Kuala Lumpur",
    tariffSgdPerKwh: 0.22,
    gfaSqm: 36000,
  },
];

/** One seeded person per role. The role header resolves to these records. */
export const USERS: readonly User[] = [
  {
    id: "user-aom",
    name: "Aisyah Rahman",
    email: "aisyah.rahman@keppel.example",
    role: "aom",
    siteId: TOWER_K,
  },
  {
    id: "user-chief",
    name: "Daniel Tan",
    email: "daniel.tan@keppel.example",
    role: "chief_engineer",
    siteId: TOWER_K,
  },
  {
    id: "user-reviewer",
    name: "Priya Nair",
    email: "priya.nair@keppel.example",
    role: "pill_reviewer",
    siteId: null,
  },
  {
    id: "user-operator",
    name: "Faizal Osman",
    email: "faizal.osman@keppel.example",
    role: "site_operator",
    siteId: TOWER_K,
  },
  {
    id: "user-governance",
    name: "Grace Lim",
    email: "grace.lim@keppel.example",
    role: "governance_admin",
    siteId: null,
  },
];

const PLANTS: readonly { siteId: string; plant: string; firstFloor: number; lastFloor: number }[] = [
  { siteId: TOWER_K, plant: "CP-1", firstFloor: 10, lastFloor: 30 },
  { siteId: HARBOUR_ONE, plant: "CP-2", firstFloor: 1, lastFloor: 20 },
  { siteId: KL_SENTRAL, plant: "CP-3", firstFloor: 1, lastFloor: 15 },
];

/** Plant + cooling tower + one AHU per floor, per site. */
export function buildAssets(): Asset[] {
  const assets: Asset[] = [];

  for (const { siteId, plant, firstFloor, lastFloor } of PLANTS) {
    assets.push({
      id: `${siteId}-${plant.toLowerCase()}`,
      siteId,
      name: `Chiller Plant ${plant}`,
      assetType: "chiller_plant",
      chillerPlant: plant,
      floor: null,
      zone: null,
      ratedKw: 1200,
    });

    assets.push({
      id: `${siteId}-${plant.toLowerCase().replace("cp", "ct")}`,
      siteId,
      name: `Cooling Tower ${plant.replace("CP", "CT")}`,
      assetType: "cooling_tower",
      chillerPlant: plant,
      floor: null,
      zone: null,
      ratedKw: 180,
    });

    for (let floor = firstFloor; floor <= lastFloor; floor += 1) {
      assets.push({
        id: `${siteId}-ahu-${floor}`,
        siteId,
        name: `AHU L${floor}`,
        assetType: "ahu",
        chillerPlant: plant,
        floor,
        zone: null,
        ratedKw: 45,
      });
    }
  }

  return assets;
}

const TENANT_NAMES: readonly string[] = [
  "Northwind Capital",
  "Meridian Legal",
  "Kestrel Analytics",
  "Orchard Fintech",
  "Straits Design",
  "Vantage HR",
  "Bluepeak Media",
  "Cendana Ventures",
];

/** Eight Tower K leases, floors 18–25, all on the standard comfort band. */
export function buildTenants(): Tenant[] {
  return TENANT_NAMES.map((name, index) => {
    const floor = 18 + index;
    return {
      id: `tenant-towerk-${floor}`,
      siteId: TOWER_K,
      name,
      floor,
      leaseComfortMinC: 22.5,
      leaseComfortMaxC: 24.5,
      leaseHours: "Mon-Fri 08:00-19:00",
    };
  });
}

const DAYS = 14;
const READINGS_PER_DAY = 96;
const START_KW_PER_RT = 0.623;
const END_KW_PER_RT = 0.713;
const BASE_LOAD_RT = 850;
const LOAD_SWING_RT = 150;
/** 2026-09-01T00:00:00Z — day 1 of the observation window. */
const WINDOW_START_MS = Date.UTC(2026, 8, 1, 0, 0, 0);

/**
 * 14 days × 96 readings. Each day's mean walks linearly from 0.6230 to 0.7130; per-reading
 * noise is zero-mean *within each day*, so the daily means land exactly on the target line
 * regardless of the random draw.
 */
export function buildChillerReadings(): ChillerReading[] {
  const rng = new Rng(config.seed + 1);
  const readings: ChillerReading[] = [];

  for (let day = 0; day < DAYS; day += 1) {
    const progress = day / (DAYS - 1);
    const dayMean = START_KW_PER_RT + (END_KW_PER_RT - START_KW_PER_RT) * progress;

    const noise: number[] = [];
    for (let slot = 0; slot < READINGS_PER_DAY; slot += 1) {
      noise.push(rng.gauss(0, 0.012));
    }
    const noiseMean = noise.reduce((total, value) => total + value, 0) / READINGS_PER_DAY;

    for (let slot = 0; slot < READINGS_PER_DAY; slot += 1) {
      const hour = (slot * 15) / 60;
      // A full sine cycle averages exactly to BASE_LOAD_RT across 96 uniform samples.
      const loadRt = rng.round(
        BASE_LOAD_RT + LOAD_SWING_RT * Math.sin(((hour - 5) / 24) * Math.PI * 2),
        1,
      );
      const kwPerRt = rng.round(dayMean + ((noise[slot] ?? 0) - noiseMean), 4);

      readings.push({
        ts: new Date(WINDOW_START_MS + (day * READINGS_PER_DAY + slot) * 15 * 60_000).toISOString(),
        loadRt,
        kwPerRt,
      });
    }
  }

  return readings;
}

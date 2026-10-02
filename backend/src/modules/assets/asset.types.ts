/**
 * Physical and commercial entities: sites, assets, tenants.
 *
 * `chillerPlant`, `assetType` and `tariffSgdPerKwh` are exactly the three fields the FR-09
 * context check compares before a pill may transfer between sites.
 */

export const ASSET_TYPES = [
  "chiller_plant",
  "ahu",
  "cooling_tower",
  "vav_box",
  "tenant_zone",
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === "string" && (ASSET_TYPES as readonly string[]).includes(value);
}

/** A building. Owns a tariff and a floor plate. */
export interface Site {
  id: string;
  name: string;
  city: string;
  /** Blended commercial tariff in SGD per kWh. */
  tariffSgdPerKwh: number;
  /** Gross floor area in square metres — used as a scale check on transfer. */
  gfaSqm: number;
}

/** A piece of plant or a controlled zone. */
export interface Asset {
  id: string;
  siteId: string;
  name: string;
  assetType: AssetType;
  /** Which chiller plant serves this asset, e.g. `CP-1`. */
  chillerPlant: string | null;
  floor: number | null;
  zone: string | null;
  ratedKw: number | null;
}

/** A leaseholder with contractual comfort terms. */
export interface Tenant {
  id: string;
  siteId: string;
  name: string;
  floor: number;
  /** Contractual comfort band, inclusive. */
  leaseComfortMinC: number;
  leaseComfortMaxC: number;
  /** Leased hours, e.g. `Mon-Fri 08:00-19:00`. */
  leaseHours: string;
}

/**
 * Read/write access to sites, assets and tenants. No business rules live here — only
 * lookup and the not-found contract.
 */

import { NotFoundError } from "@/shared/errors";
import { db } from "@/shared/store";
import type { Asset, AssetType, Site, Tenant } from "./asset.types";

export function listSites(): Site[] {
  return [...db().sites];
}

export function getSite(id: string): Site {
  const site = db().sites.find((candidate) => candidate.id === id);
  if (!site) throw new NotFoundError("Site", id);
  return site;
}

export function listAssets(siteId?: string, assetType?: AssetType): Asset[] {
  return db().assets.filter(
    (asset) =>
      (siteId === undefined || asset.siteId === siteId) &&
      (assetType === undefined || asset.assetType === assetType),
  );
}

export function getAsset(id: string): Asset {
  const asset = db().assets.find((candidate) => candidate.id === id);
  if (!asset) throw new NotFoundError("Asset", id);
  return asset;
}

export function listTenants(siteId?: string): Tenant[] {
  return db().tenants.filter((tenant) => siteId === undefined || tenant.siteId === siteId);
}

export function getTenant(id: string): Tenant {
  const tenant = db().tenants.find((candidate) => candidate.id === id);
  if (!tenant) throw new NotFoundError("Tenant", id);
  return tenant;
}

/** Nearest controlling asset for a floor — used to attach a case to plant. */
export function findAssetByFloor(siteId: string, floor: number): Asset | null {
  return (
    db().assets.find(
      (asset) => asset.siteId === siteId && asset.floor === floor && asset.assetType === "ahu",
    ) ??
    db().assets.find((asset) => asset.siteId === siteId && asset.assetType === "chiller_plant") ??
    null
  );
}

export function findTenantByFloor(siteId: string, floor: number): Tenant | null {
  return db().tenants.find((tenant) => tenant.siteId === siteId && tenant.floor === floor) ?? null;
}

export function findSiteByName(name: string): Site | null {
  const needle = name.trim().toLowerCase();
  return db().sites.find((site) => site.name.toLowerCase() === needle) ?? null;
}

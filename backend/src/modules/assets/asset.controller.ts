/**
 * Sites, assets and tenants — read-only reference data for the console's pickers.
 */

import { Router } from "express";
import { readQueryString } from "@/shared/http";
import { listAssets, listSites, listTenants } from "./asset.repository";
import { isAssetType } from "./asset.types";

export const assetController = Router();

assetController.get("/sites", (_req, res) => {
  res.json({ sites: listSites() });
});

assetController.get("/assets", (req, res) => {
  const assetTypeRaw = readQueryString(req.query.assetType);
  const assetType =
    assetTypeRaw !== undefined && isAssetType(assetTypeRaw) ? assetTypeRaw : undefined;

  res.json({ assets: listAssets(readQueryString(req.query.siteId), assetType) });
});

assetController.get("/tenants", (req, res) => {
  res.json({ tenants: listTenants(readQueryString(req.query.siteId)) });
});

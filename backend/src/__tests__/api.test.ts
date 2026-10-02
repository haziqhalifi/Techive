/**
 * HTTP surface, driven through supertest. Covers the error contract and deny-by-default access.
 */

import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "@/app";
import { HERO_CASE_INPUT, seedWorld } from "./helpers";

describe("HTTP API", () => {
  beforeEach(() => {
    seedWorld();
  });

  it("reports health", async () => {
    const response = await request(createApp()).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
  });

  it("lists the five roles with their permissions", async () => {
    const response = await request(createApp()).get("/api/roles");
    expect(response.status).toBe(200);
    expect(response.body.roles).toHaveLength(5);
    expect(response.body.roles.map((entry: { role: string }) => entry.role)).toContain(
      "pill_reviewer",
    );
  });

  it("runs the hero case end to end", async () => {
    const response = await request(createApp())
      .post("/api/cases")
      .set("x-harvest-role", "aom")
      .send(HERO_CASE_INPUT);

    expect(response.status).toBe(201);
    expect(response.body.route).toBe("execute_with_approval");
    expect(response.body.metrics.excessKwh).toBeGreaterThan(0);
    expect(response.body.options.some((option: { selected: boolean }) => option.selected)).toBe(
      true,
    );
  });

  it("denies the audit log to a site operator", async () => {
    const response = await request(createApp())
      .get("/api/audit")
      .set("x-harvest-role", "site_operator");

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("forbidden");
  });

  it("allows the audit log to a governance admin, with a valid chain", async () => {
    const response = await request(createApp())
      .get("/api/audit")
      .set("x-harvest-role", "governance_admin");

    expect(response.status).toBe(200);
    expect(response.body.verification.valid).toBe(true);
    expect(response.body.entries.length).toBeGreaterThan(0);
    expect(response.body.entries[0].shortHash).toBeTruthy();
  });

  it("serves analytics metrics and the priced levers", async () => {
    const response = await request(createApp()).get("/api/analytics/metrics");

    expect(response.status).toBe(200);
    expect(response.body.source).toBe("telemetry");
    expect(response.body.metrics.excessSgd).toBeGreaterThan(0);
    expect(response.body.levers.length).toBeGreaterThan(0);
    expect(response.body.summary.endsWith(".")).toBe(true);
  });

  it("serves the retrieval eval report", async () => {
    const response = await request(createApp()).get("/api/pills/eval");

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(12);
    expect(response.body.recall).toBe(1);
  });

  it("lists the pill library", async () => {
    const response = await request(createApp()).get("/api/pills");
    expect(response.status).toBe(200);
    expect(response.body.pills).toHaveLength(6);
  });

  it("returns 404 in the standard error shape", async () => {
    const response = await request(createApp()).get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
  });

  it("returns 422 for an invalid case body", async () => {
    const response = await request(createApp())
      .post("/api/cases")
      .set("x-harvest-role", "aom")
      .send({ siteId: "site-towerk" });

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("validation_failure");
  });

  it("returns 404 for an unknown case", async () => {
    const response = await request(createApp())
      .get("/api/cases/case-9999")
      .set("x-harvest-role", "aom");

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("not_found");
    expect(response.body.error.details.entity).toBe("Case");
    expect(response.body.error.details.id).toBe("case-9999");
  });

  it("refuses a second seed from a non-admin", async () => {
    const response = await request(createApp())
      .post("/api/seed")
      .set("x-harvest-role", "site_operator")
      .send({});

    expect(response.status).toBe(403);
  });

  it("allows a governance admin to re-seed", async () => {
    const response = await request(createApp())
      .post("/api/seed")
      .set("x-harvest-role", "governance_admin")
      .send({});

    expect(response.status).toBe(201);
    expect(response.body.approvedPills).toBe(5);
    expect(response.body.draftPills).toBe(1);
  });

  it("serves sites, assets and tenants", async () => {
    const app = createApp();

    const sites = await request(app).get("/api/sites");
    expect(sites.status).toBe(200);
    expect(sites.body.sites).toHaveLength(3);

    const assets = await request(app).get("/api/assets?siteId=site-towerk&assetType=ahu");
    expect(assets.status).toBe(200);
    expect(assets.body.assets.length).toBeGreaterThan(0);

    const tenants = await request(app).get("/api/tenants?siteId=site-towerk");
    expect(tenants.status).toBe(200);
    expect(tenants.body.tenants).toHaveLength(8);
  });
});

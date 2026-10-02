/**
 * Schema <-> seed coherence.
 *
 * There is no Postgres on this machine, so the SQL is never executed here. These tests are the
 * local substitute: they parse both files and assert the seed only writes columns the schema
 * declares, that the schema still declares every column the model needs, and that the emitted
 * audit chain is intact. `scripts/db-smoke.sh` and the CI `db-smoke` job are what actually run it.
 *
 * The parsers depend on two conventions, both enforced by the files themselves:
 *   - `data/schema.sql` puts one column or constraint per line.
 *   - every seed INSERT names its columns explicitly.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runSeed } from "@/modules/synthetic/seed.controller";
import { renderSeedSql, sqlString } from "@/modules/synthetic/sql-export";
import { GENESIS_HASH, canonicalJson, verifyChain } from "@/shared/hash";
import { db } from "@/shared/store";

const ROOT = new URL("../../../", import.meta.url);
const SCHEMA_PATH = fileURLToPath(new URL("data/schema.sql", ROOT));
const SEED_PATH = fileURLToPath(new URL("data/seed.sql", ROOT));

const readSchema = (): string => readFileSync(SCHEMA_PATH, "utf8").replace(/\r\n/g, "\n");
const readSeed = (): string => readFileSync(SEED_PATH, "utf8").replace(/\r\n/g, "\n");

/** Table name -> declared column names. */
function parseSchema(sql: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const tablePattern = /CREATE TABLE\s+(\w+)\s*\(([\s\S]*?)\n\);/g;

  let match: RegExpExecArray | null;
  while ((match = tablePattern.exec(sql)) !== null) {
    const [, name, body] = match;
    if (name === undefined || body === undefined) continue;

    const columns = new Set<string>();
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (line === "") continue;
      if (/^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK)\b/i.test(line)) continue;

      const column = /^([a-z_][a-z0-9_]*)\s/.exec(line);
      if (column?.[1] !== undefined) columns.add(column[1]);
    }
    tables.set(name, columns);
  }

  return tables;
}

/** Every INSERT the seed performs, with its explicit column list. */
function parseSeedInserts(sql: string): { table: string; columns: string[] }[] {
  const inserts: { table: string; columns: string[] }[] = [];
  const insertPattern = /INSERT INTO\s+(\w+)\s*\(([^)]*)\)/g;

  let match: RegExpExecArray | null;
  while ((match = insertPattern.exec(sql)) !== null) {
    const [, table, columns] = match;
    if (table === undefined || columns === undefined) continue;
    inserts.push({ table, columns: columns.split(",").map((column) => column.trim()) });
  }

  return inserts;
}

/**
 * The contract between the durable schema and the domain model, written out explicitly so a
 * dropped or renamed column fails here rather than in production. Covers the tables the seed
 * leaves empty, which no INSERT-based check can reach.
 */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  sites: ["id", "name", "city", "tariff_sgd_per_kwh", "gfa_sqm"],
  users: ["id", "name", "email", "role", "site_id"],
  assets: ["id", "site_id", "name", "asset_type", "chiller_plant", "floor", "zone", "rated_kw"],
  tenants: [
    "id",
    "site_id",
    "name",
    "floor",
    "lease_comfort_min_c",
    "lease_comfort_max_c",
    "lease_hours",
  ],
  chiller_readings: ["ts", "load_rt", "kw_per_rt"],
  pills: [
    "id",
    "slug",
    "title",
    "domain",
    "owner_id",
    "origin_site_id",
    "current_version_id",
    "created_at",
  ],
  pill_versions: [
    "id",
    "pill_id",
    "version",
    "status",
    "summary",
    "triggers",
    "action_tier",
    "steps",
    "context_requirements",
    "author_id",
    "reviewer_id",
    "review_note",
    "approved_at",
    "supersedes_version_id",
    "created_at",
  ],
  transcript_excerpts: ["id", "pill_id", "speaker", "text", "captured_at", "tags", "embedding"],
  claims: ["id", "pill_version_id", "kind", "text", "source_excerpt_id", "confidence"],
  pill_options: [
    "id",
    "pill_version_id",
    "label",
    "detail",
    "action_tier",
    "sgd_delta",
    "policy_rank",
    "source_excerpt_id",
  ],
  cases: [
    "id",
    "site_id",
    "asset_id",
    "tenant_id",
    "floor",
    "zone",
    "reported_at",
    "symptom",
    "description",
    "reported_by",
    "status",
    "transfer_from_pill_id",
    "parsed",
    "gate",
    "context_check",
    "created_at",
  ],
  decision_options: [
    "id",
    "case_id",
    "pill_version_id",
    "label",
    "detail",
    "action_tier",
    "sgd_delta",
    "policy_rank",
    "selected",
  ],
  outcomes: [
    "id",
    "case_id",
    "option_id",
    "decided_by",
    "decided_at",
    "verdict",
    "comfort_delta_c",
    "energy_delta_kwh",
    "note",
  ],
  audit_logs: [
    "seq",
    "id",
    "occurred_at",
    "actor_id",
    "actor_name",
    "actor_role",
    "action",
    "entity_type",
    "entity_id",
    "payload",
    "prev_hash",
    "hash",
  ],
};

describe("schema", () => {
  it("declares exactly the tables and columns the model needs", () => {
    const schema = parseSchema(readSchema());

    expect([...schema.keys()].sort()).toEqual(Object.keys(EXPECTED_COLUMNS).sort());

    for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
      expect([...(schema.get(table) ?? [])].sort(), `table '${table}'`).toEqual([...columns].sort());
    }
  });

  it("encodes the product rules at the storage layer", () => {
    const schema = readSchema();

    // FR-02 — a non-unknown claim must cite a transcript excerpt.
    expect(schema).toContain("CHECK (kind = 'unknown' OR source_excerpt_id IS NOT NULL)");
    // FR-03 — a version's reviewer may not be its author.
    expect(schema).toContain("CHECK (reviewer_id IS NULL OR reviewer_id <> author_id)");
    // FR-11 — the audit log is append-only.
    expect(schema).toContain("audit_logs is append-only");
    // pgvector, and the HNSW index over it.
    expect(schema).toContain("vector(1536)");
    expect(schema).toContain("USING hnsw (embedding vector_cosine_ops)");
  });
});

describe("seed <-> schema", () => {
  it("only writes tables and columns the schema declares", () => {
    const schema = parseSchema(readSchema());
    const inserts = parseSeedInserts(readSeed());

    expect(inserts.length).toBeGreaterThan(0);

    for (const { table, columns } of inserts) {
      const declared = schema.get(table);
      expect(declared, `table '${table}' is missing from data/schema.sql`).toBeDefined();

      for (const column of columns) {
        expect(
          declared?.has(column) ?? false,
          `column '${table}.${column}' is missing from data/schema.sql`,
        ).toBe(true);
      }
    }
  });

  it("covers every table with an INSERT or an explicit 'no rows' marker", () => {
    const seed = readSeed();

    for (const table of Object.keys(EXPECTED_COLUMNS)) {
      const touched = seed.includes(`INSERT INTO ${table} `) || seed.includes(`-- ${table}: no rows`);
      expect(touched, `data/seed.sql never mentions '${table}'`).toBe(true);
    }
  });
});

describe("audit chain in the seed", () => {
  it("still verifies, and its hashes survive serialisation", () => {
    runSeed();
    const store = db();

    expect(verifyChain(store.auditLogs)).toEqual({ valid: true, brokenAtSeq: null });
    store.auditLogs.forEach((entry, index) => {
      expect(entry.seq).toBe(index + 1);
    });

    const sql = renderSeedSql(store);

    // The genesis link is what proves the chain starts where it should.
    expect(sql).toContain(GENESIS_HASH);

    for (const entry of store.auditLogs) {
      expect(sql).toContain(entry.hash);
      expect(sql).toContain(entry.prevHash);
      // Exact literal, so a payload containing a quote would still be caught.
      expect(sql).toContain(`${sqlString(canonicalJson(entry.payload))}::json`);
    }
  });
});

describe("the seeded world satisfies the constraints the database will enforce", () => {
  it("FR-02 — every non-unknown claim cites an excerpt", () => {
    runSeed();

    for (const claim of db().claims) {
      if (claim.kind === "unknown") continue;
      expect(claim.sourceExcerptId, `claim ${claim.id} (${claim.kind}) has no source`).not.toBeNull();
    }
  });

  it("FR-03 — no version is reviewed by its own author", () => {
    runSeed();

    for (const version of db().pillVersions) {
      if (version.reviewerId === null) continue;
      expect(version.reviewerId, `version ${version.id} is self-approved`).not.toBe(version.authorId);
    }
  });
});

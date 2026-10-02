/**
 * Deterministic SQL export of the seeded world.
 *
 * `renderSeedSql` turns a `StoreState` into the `data/seed.sql` that populates `data/schema.sql`.
 * It is a **pure function with no I/O** so the test suite can re-render the seed in memory and
 * assert the committed file is byte-identical — that drift guard is what makes it safe to commit
 * a generated artifact.
 *
 * Escaping is the only defence here: a static `.sql` file cannot use bind parameters, so every
 * value is rendered through the `sql*` helpers below. The output assumes
 * `standard_conforming_strings = on` (emitted explicitly), which makes quote-doubling sufficient
 * and means backslashes are literal and must NOT be escaped.
 */

import { canonicalJson } from "@/shared/hash";
import type { StoreState } from "@/shared/store";

// ---------------------------------------------------------------------------
// Escapers
// ---------------------------------------------------------------------------

/** A `text` literal. Doubles single quotes; rejects NUL, which Postgres text cannot store. */
export function sqlString(value: string): string {
  if (value.includes("\u0000")) {
    throw new Error("SQL string literals cannot contain NUL (\\u0000).");
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/** A numeric literal. Refuses to emit NaN/Infinity, which would produce invalid SQL. */
export function sqlNumber(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Refusing to emit a non-finite number: ${String(value)}`);
  }
  return String(value);
}

export function sqlBoolean(value: boolean): string {
  return value ? "TRUE" : "FALSE";
}

export function sqlTimestamp(iso: string): string {
  return `${sqlString(iso)}::timestamptz`;
}

/** Canonical JSON, so the emitted literal does not depend on key construction order. */
export function sqlJson(value: unknown): string {
  return `${sqlString(canonicalJson(value))}::json`;
}

export function sqlJsonb(value: unknown): string {
  return `${sqlString(canonicalJson(value))}::jsonb`;
}

export function sqlTextArray(values: readonly string[]): string {
  if (values.length === 0) return "'{}'::text[]";
  return `ARRAY[${values.map((value) => sqlString(value)).join(", ")}]::text[]`;
}

/** 1536-dim embedding, or NULL. The demo has no embeddings — retrieval is token overlap. */
export function sqlVector(embedding: readonly number[] | null): string {
  if (embedding === null) return "NULL";
  if (embedding.length !== 1536) {
    throw new Error(`Expected a 1536-dim embedding, received ${embedding.length}.`);
  }
  return `${sqlString(`[${embedding.map((value) => sqlNumber(value)).join(",")}]`)}::vector`;
}

function nullable(value: string | null, render: (input: string) => string): string {
  return value === null ? "NULL" : render(value);
}

function nullableNumber(value: number | null): string {
  return value === null ? "NULL" : sqlNumber(value);
}

// ---------------------------------------------------------------------------
// Statement helpers
// ---------------------------------------------------------------------------

function insertMany(
  table: string,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): string {
  if (rows.length === 0) return `-- ${table}: no rows\n`;
  const body = rows.map((row) => `  (${row.join(", ")})`).join(",\n");
  return `INSERT INTO ${table} (${columns.join(", ")}) VALUES\n${body};\n`;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

/** One statement per day, so the file stays diffable without 1,344 separate statements. */
const READINGS_PER_STATEMENT = 96;

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export function renderSeedSql(store: StoreState): string {
  const sections: string[] = [];

  sections.push(
    [
      "-- =============================================================",
      "-- VERDANT — seed data.",
      "--",
      "-- GENERATED FILE — DO NOT EDIT.",
      "-- Regenerate with:   cd backend && npm run seed:sql",
      "--",
      "-- Derived from the same deterministic world as the in-memory store, so it cannot drift.",
      "-- A test re-renders this in memory and asserts the committed file matches byte-for-byte.",
      "--",
      "-- ALL DATA IS SYNTHETIC.",
      "-- =============================================================",
      "",
      "SET standard_conforming_strings = on;",
      "",
      "BEGIN;",
      "",
    ].join("\n"),
  );

  // --- Physical & commercial entities ---------------------------------------
  sections.push(
    insertMany(
      "sites",
      ["id", "name", "city", "tariff_sgd_per_kwh", "gfa_sqm"],
      store.sites.map((site) => [
        sqlString(site.id),
        sqlString(site.name),
        sqlString(site.city),
        sqlNumber(site.tariffSgdPerKwh),
        sqlNumber(site.gfaSqm),
      ]),
    ),
  );

  sections.push(
    insertMany(
      "users",
      ["id", "name", "email", "role", "site_id"],
      store.users.map((user) => [
        sqlString(user.id),
        sqlString(user.name),
        sqlString(user.email),
        sqlString(user.role),
        nullable(user.siteId, sqlString),
      ]),
    ),
  );

  sections.push(
    insertMany(
      "assets",
      ["id", "site_id", "name", "asset_type", "chiller_plant", "floor", "zone", "rated_kw"],
      store.assets.map((asset) => [
        sqlString(asset.id),
        sqlString(asset.siteId),
        sqlString(asset.name),
        sqlString(asset.assetType),
        nullable(asset.chillerPlant, sqlString),
        nullableNumber(asset.floor),
        nullable(asset.zone, sqlString),
        nullableNumber(asset.ratedKw),
      ]),
    ),
  );

  sections.push(
    insertMany(
      "tenants",
      ["id", "site_id", "name", "floor", "lease_comfort_min_c", "lease_comfort_max_c", "lease_hours"],
      store.tenants.map((tenant) => [
        sqlString(tenant.id),
        sqlString(tenant.siteId),
        sqlString(tenant.name),
        sqlNumber(tenant.floor),
        sqlNumber(tenant.leaseComfortMinC),
        sqlNumber(tenant.leaseComfortMaxC),
        sqlString(tenant.leaseHours),
      ]),
    ),
  );

  // --- Telemetry -------------------------------------------------------------
  const readingStatements = chunk(store.readings, READINGS_PER_STATEMENT).map((batch) =>
    insertMany(
      "chiller_readings",
      ["ts", "load_rt", "kw_per_rt"],
      batch.map((reading) => [
        sqlTimestamp(reading.ts),
        sqlNumber(reading.loadRt),
        sqlNumber(reading.kwPerRt),
      ]),
    ),
  );
  sections.push(
    readingStatements.length === 0
      ? "-- chiller_readings: no rows\n"
      : `-- chiller_readings: ${store.readings.length} rows, ${readingStatements.length} statements\n${readingStatements.join("")}`,
  );

  // --- Intelligence Pills ----------------------------------------------------
  // `current_version_id` is NULL here: pills and pill_versions reference each other, so the
  // back-reference is applied by the UPDATE below, after the versions exist.
  sections.push(
    insertMany(
      "pills",
      ["id", "slug", "title", "domain", "owner_id", "origin_site_id", "current_version_id", "created_at"],
      store.pills.map((pill) => [
        sqlString(pill.id),
        sqlString(pill.slug),
        sqlString(pill.title),
        sqlString(pill.domain),
        sqlString(pill.ownerId),
        sqlString(pill.originSiteId),
        "NULL",
        sqlTimestamp(pill.createdAt),
      ]),
    ),
  );

  sections.push(
    insertMany(
      "transcript_excerpts",
      ["id", "pill_id", "speaker", "text", "captured_at", "tags", "embedding"],
      store.transcriptExcerpts.map((excerpt) => [
        sqlString(excerpt.id),
        sqlString(excerpt.pillId),
        sqlString(excerpt.speaker),
        sqlString(excerpt.text),
        sqlTimestamp(excerpt.capturedAt),
        sqlTextArray(excerpt.tags),
        sqlVector(excerpt.embedding),
      ]),
    ),
  );

  sections.push(
    insertMany(
      "pill_versions",
      [
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
      store.pillVersions.map((version) => [
        sqlString(version.id),
        sqlString(version.pillId),
        sqlNumber(version.version),
        sqlString(version.status),
        sqlString(version.summary),
        sqlTextArray(version.triggers),
        sqlString(version.actionTier),
        sqlJsonb(version.steps),
        sqlJsonb(version.contextRequirements),
        sqlString(version.authorId),
        nullable(version.reviewerId, sqlString),
        nullable(version.reviewNote, sqlString),
        version.approvedAt === null ? "NULL" : sqlTimestamp(version.approvedAt),
        nullable(version.supersedesVersionId, sqlString),
        sqlTimestamp(version.createdAt),
      ]),
    ),
  );

  const liveVersions = store.pills.filter((pill) => pill.currentVersionId !== null);
  sections.push(
    liveVersions.length === 0
      ? "-- pills.current_version_id: nothing to point at\n"
      : liveVersions
          .map(
            (pill) =>
              `UPDATE pills SET current_version_id = ${sqlString(pill.currentVersionId ?? "")} WHERE id = ${sqlString(pill.id)};\n`,
          )
          .join(""),
  );

  sections.push(
    insertMany(
      "claims",
      ["id", "pill_version_id", "kind", "text", "source_excerpt_id", "confidence"],
      store.claims.map((claim) => [
        sqlString(claim.id),
        sqlString(claim.pillVersionId),
        sqlString(claim.kind),
        sqlString(claim.text),
        nullable(claim.sourceExcerptId, sqlString),
        sqlNumber(claim.confidence),
      ]),
    ),
  );

  sections.push(
    insertMany(
      "pill_options",
      [
        "id",
        "pill_version_id",
        "label",
        "detail",
        "action_tier",
        "sgd_delta",
        "policy_rank",
        "source_excerpt_id",
      ],
      store.pillOptions.map((option) => [
        sqlString(option.id),
        sqlString(option.pillVersionId),
        sqlString(option.label),
        sqlString(option.detail),
        sqlString(option.actionTier),
        sqlNumber(option.sgdDelta),
        sqlNumber(option.policyRank),
        nullable(option.sourceExcerptId, sqlString),
      ]),
    ),
  );

  // --- Decision runtime ------------------------------------------------------
  sections.push(
    insertMany(
      "cases",
      [
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
      store.cases.map((item) => [
        sqlString(item.id),
        sqlString(item.siteId),
        nullable(item.assetId, sqlString),
        nullable(item.tenantId, sqlString),
        nullableNumber(item.floor),
        nullable(item.zone, sqlString),
        sqlTimestamp(item.reportedAt),
        sqlString(item.symptom),
        sqlString(item.description),
        sqlString(item.reportedBy),
        sqlString(item.status),
        nullable(item.transferFromPillId, sqlString),
        item.parsed === null ? "NULL" : sqlJsonb(item.parsed),
        item.gate === null ? "NULL" : sqlJsonb(item.gate),
        item.contextCheck === null ? "NULL" : sqlJsonb(item.contextCheck),
        sqlTimestamp(item.createdAt),
      ]),
    ),
  );

  sections.push(
    insertMany(
      "decision_options",
      [
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
      store.decisionOptions.map((option) => [
        sqlString(option.id),
        sqlString(option.caseId),
        sqlString(option.pillVersionId),
        sqlString(option.label),
        sqlString(option.detail),
        sqlString(option.actionTier),
        sqlNumber(option.sgdDelta),
        sqlNumber(option.policyRank),
        sqlBoolean(option.selected),
      ]),
    ),
  );

  sections.push(
    insertMany(
      "outcomes",
      [
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
      store.outcomes.map((outcome) => [
        sqlString(outcome.id),
        sqlString(outcome.caseId),
        nullable(outcome.optionId, sqlString),
        sqlString(outcome.decidedBy),
        sqlTimestamp(outcome.decidedAt),
        sqlString(outcome.verdict),
        nullableNumber(outcome.comfortDeltaC),
        nullableNumber(outcome.energyDeltaKwh),
        sqlString(outcome.note),
      ]),
    ),
  );

  // --- Audit chain -----------------------------------------------------------
  // Hashes are copied verbatim from the TypeScript chain. They are never recomputed in SQL:
  // canonical key-sorting is not reproducible in Postgres, so the chain's integrity is owned
  // by `shared/hash.ts`. Ascending seq satisfies the append-only trigger, which only fires on
  // UPDATE or DELETE.
  const auditRows = [...store.auditLogs].sort((a, b) => a.seq - b.seq);
  sections.push(
    insertMany(
      "audit_logs",
      [
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
      auditRows.map((entry) => [
        sqlNumber(entry.seq),
        sqlString(entry.id),
        sqlTimestamp(entry.occurredAt),
        sqlString(entry.actorId),
        sqlString(entry.actorName),
        sqlString(entry.actorRole),
        sqlString(entry.action),
        sqlString(entry.entityType),
        sqlString(entry.entityId),
        sqlJson(entry.payload),
        sqlString(entry.prevHash),
        sqlString(entry.hash),
      ]),
    ),
  );

  sections.push(
    [
      "COMMIT;",
      "",
      "-- Row counts",
      ...countsOf(store).map(([table, count]) => `--   ${table.padEnd(18)} ${count}`),
      "",
    ].join("\n"),
  );

  return sections.join("\n");
}

function countsOf(store: StoreState): [string, number][] {
  return [
    ["sites", store.sites.length],
    ["users", store.users.length],
    ["assets", store.assets.length],
    ["tenants", store.tenants.length],
    ["chiller_readings", store.readings.length],
    ["pills", store.pills.length],
    ["transcript_excerpts", store.transcriptExcerpts.length],
    ["pill_versions", store.pillVersions.length],
    ["claims", store.claims.length],
    ["pill_options", store.pillOptions.length],
    ["cases", store.cases.length],
    ["decision_options", store.decisionOptions.length],
    ["outcomes", store.outcomes.length],
    ["audit_logs", store.auditLogs.length],
  ];
}

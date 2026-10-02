/**
 * The seed exporter.
 *
 * The load-bearing test here is the drift guard: `data/seed.sql` is a committed, generated
 * artifact, so it is only safe to trust if a test proves it still matches what the code renders.
 * The escaper tests stand in for a database: there is no Postgres available locally, so the
 * adversarial-string cases are the only thing asserting the output is well-formed SQL.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runSeed } from "@/modules/synthetic/seed.controller";
import {
  renderSeedSql,
  sqlJsonb,
  sqlNumber,
  sqlString,
  sqlTextArray,
  sqlTimestamp,
  sqlVector,
} from "@/modules/synthetic/sql-export";
import { db } from "@/shared/store";

/** `backend/src/__tests__/` -> repo root -> `data/seed.sql`. */
const SEED_SQL_PATH = fileURLToPath(new URL("../../../data/seed.sql", import.meta.url));

/** Normalised so a CRLF checkout on Windows still compares equal (see .gitattributes). */
function readCommittedSeed(): string {
  return readFileSync(SEED_SQL_PATH, "utf8").replace(/\r\n/g, "\n");
}

describe("sqlString", () => {
  it("doubles single quotes", () => {
    expect(sqlString("O'Brien")).toBe("'O''Brien'");
  });

  it("neutralises an injection attempt", () => {
    expect(sqlString("'; DROP TABLE pills; --")).toBe("'''; DROP TABLE pills; --'");
  });

  it("leaves backslashes literal — standard_conforming_strings is on", () => {
    expect(sqlString("C:\\temp")).toBe("'C:\\temp'");
  });

  it("passes newlines through unescaped", () => {
    expect(sqlString("a\nb")).toBe("'a\nb'");
  });

  it("rejects NUL, which Postgres text cannot store", () => {
    expect(() => sqlString("a\u0000b")).toThrow(/NUL/);
  });
});

describe("scalar renderers", () => {
  it("renders finite numbers verbatim", () => {
    expect(sqlNumber(0.28)).toBe("0.28");
    expect(sqlNumber(-3)).toBe("-3");
  });

  it("refuses to emit NaN or Infinity", () => {
    expect(() => sqlNumber(Number.NaN)).toThrow(/non-finite/);
    expect(() => sqlNumber(Number.POSITIVE_INFINITY)).toThrow(/non-finite/);
  });

  it("casts timestamps so Postgres parses them as instants, not text", () => {
    expect(sqlTimestamp("2026-09-15T01:00:00.000Z")).toBe(
      "'2026-09-15T01:00:00.000Z'::timestamptz",
    );
  });

  it("renders text arrays, including the empty case", () => {
    expect(sqlTextArray([])).toBe("'{}'::text[]");
    expect(sqlTextArray(["a", "b'c"])).toBe("ARRAY['a', 'b''c']::text[]");
  });

  it("renders jsonb canonically, so key order cannot change the bytes", () => {
    expect(sqlJsonb({ b: 1, a: 2 })).toBe(`'{"a":2,"b":1}'::jsonb`);
  });

  it("renders NULL embeddings, and refuses a wrong-dimension vector", () => {
    expect(sqlVector(null)).toBe("NULL");
    expect(() => sqlVector([1, 2, 3])).toThrow(/1536/);
  });
});

describe("drift guard", () => {
  it("the committed data/seed.sql is exactly what the current code renders", () => {
    runSeed();
    expect(renderSeedSql(db())).toBe(readCommittedSeed());
  });

  it("renders the world the README and HERO_CASE describe", () => {
    runSeed();
    const store = db();

    expect(store.sites).toHaveLength(3);
    expect(store.assets).toHaveLength(62);
    expect(store.tenants).toHaveLength(8);
    expect(store.users).toHaveLength(5);
    expect(store.readings).toHaveLength(1344);
    expect(store.pills).toHaveLength(6);

    // Cases are created at runtime, so the seed must not invent any.
    expect(store.cases).toHaveLength(0);
    expect(store.decisionOptions).toHaveLength(0);
    expect(store.outcomes).toHaveLength(0);
  });
});

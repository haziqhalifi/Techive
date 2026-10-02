/**
 * Regenerate `data/seed.sql` from the deterministic in-memory world.
 *
 *   npm run seed:sql                     write data/seed.sql
 *   npm run --silent seed:sql:stdout     print to stdout, so it can be diffed
 *
 * (`--silent` suppresses npm's own banner, which would otherwise pollute the pipe.)
 *
 * The world is a pure function of `VERDANT_SEED`, so this is reproducible: run it twice and the
 * bytes are identical. `sql-export.test.ts` asserts the committed file still matches, which is
 * what keeps the generated artifact honest. Never hand-edit `data/seed.sql`.
 */

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runSeed } from "@/modules/synthetic/seed.controller";
import { renderSeedSql } from "@/modules/synthetic/sql-export";
import { db } from "@/shared/store";

/** `backend/src/scripts/` -> repo root -> `data/seed.sql`. */
const TARGET = fileURLToPath(new URL("../../../data/seed.sql", import.meta.url));

function main(): void {
  const toStdout = process.argv.includes("--stdout");

  const report = runSeed();
  const sql = renderSeedSql(db());

  if (toStdout) {
    process.stdout.write(sql);
    return;
  }

  writeFileSync(TARGET, sql, "utf8");
  process.stdout.write(
    `Wrote ${TARGET}\n` +
      `  seed ${report.seededAt} · ${report.sites} sites, ${report.assets} assets, ` +
      `${report.tenants} tenants, ${report.readings} readings, ` +
      `${report.pills} pills (${report.approvedPills} approved, ${report.draftPills} draft), ` +
      `${report.auditEntries} audit entries\n`,
  );
}

main();

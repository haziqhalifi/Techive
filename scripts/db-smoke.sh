#!/usr/bin/env bash
# =============================================================
# VERDANT — live Postgres smoke test.
#
#   bash scripts/db-smoke.sh
#
# Applies data/schema.sql + data/seed.sql to a throwaway pgvector container and asserts the
# durable path actually works: the row counts match the seeded world, and the append-only
# trigger rejects an UPDATE. This is the only place the SQL is executed — the local test suite
# can only check it structurally.
#
# Self-skips (exit 0) when Docker is unavailable, so it is safe to call from verify.sh.
# =============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER=verdant-db
FAIL=0

ok()   { printf '\033[32m✔ %s\033[0m\n' "$1"; }
bad()  { printf '\033[31m✖ %s\033[0m\n' "$1"; FAIL=1; }
skip() { printf '\033[33m• %s\033[0m\n' "$1"; }

# --- availability -----------------------------------------------------------
if ! command -v docker >/dev/null 2>&1; then
  skip "docker not installed — skipping db smoke test"
  exit 0
fi

if ! docker info >/dev/null 2>&1; then
  skip "docker daemon not running — skipping db smoke test"
  exit 0
fi

if [ ! -f "$ROOT/data/seed.sql" ]; then
  bad "data/seed.sql is missing — run: cd backend && npm run seed:sql"
  exit 1
fi

cleanup() {
  printf '\n'
  (cd "$ROOT" && docker compose --profile postgres down -v >/dev/null 2>&1) || true
}
trap cleanup EXIT

# --- bring it up ------------------------------------------------------------
printf '\033[1m▶ starting postgres (pgvector)\033[0m\n'
if ! (cd "$ROOT" && docker compose --profile postgres up -d db); then
  bad "docker compose up failed"
  exit 1
fi

printf '\033[1m▶ waiting for health\033[0m\n'
healthy=0
for _ in $(seq 1 60); do
  status="$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || echo unknown)"
  if [ "$status" = "healthy" ]; then healthy=1; break; fi
  if [ "$status" = "unhealthy" ]; then break; fi
  sleep 2
done

if [ "$healthy" -ne 1 ]; then
  bad "database did not become healthy"
  (cd "$ROOT" && docker compose --profile postgres logs --tail 40 db) || true
  exit 1
fi
ok "database healthy"

# --- assertions -------------------------------------------------------------
query() { docker exec "$CONTAINER" psql -U verdant -d verdant -tAc "$1"; }

assert_count() { # <table> <expected>
  local actual
  actual="$(query "SELECT count(*) FROM $1" 2>/dev/null)"
  if [ "$actual" = "$2" ]; then ok "$1 = $2"; else bad "$1 = ${actual:-?} (expected $2)"; fi
}

assert_count sites 3
assert_count users 5
assert_count assets 62
assert_count tenants 8
assert_count chiller_readings 1344
assert_count pills 6
assert_count transcript_excerpts 15
assert_count pill_versions 6
assert_count claims 15
assert_count pill_options 8
assert_count cases 0
assert_count decision_options 0
assert_count outcomes 0
assert_count audit_logs 17

# FR-11 — the append-only trigger must reject a mutation.
if docker exec "$CONTAINER" psql -U verdant -d verdant \
     -c "UPDATE audit_logs SET action = 'tampered' WHERE seq = 1" >/dev/null 2>&1; then
  bad "audit_logs accepted an UPDATE — the append-only trigger is not working"
else
  ok "audit_logs rejected an UPDATE (append-only)"
fi

# --- result -----------------------------------------------------------------
if [ "$FAIL" -eq 0 ]; then
  printf '\n\033[32m\033[1m✅ db smoke passed\033[0m\n'
else
  printf '\n\033[31m\033[1m❌ db smoke failed\033[0m\n'
fi
exit "$FAIL"

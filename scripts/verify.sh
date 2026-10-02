#!/usr/bin/env bash
# =============================================================
# HARVEST — single quality gate.
# Mirrors the AGENTS.md pre-commit checklist in one command.
#
#   bash scripts/verify.sh
#
# Backend:  tsc --noEmit -> eslint -> vitest run
# Frontend: tsc --noEmit -> eslint -> vite build
#
# Both are skipped with a clear message if dependencies are not installed yet.
# =============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✔ %s\033[0m\n' "$1"; }
bad()  { printf '\033[31m✖ %s\033[0m\n' "$1"; FAIL=1; }
skip() { printf '\033[33m• %s\033[0m\n' "$1"; }

run() { # run <label> <workdir> <command...>
  local label="$1" dir="$2"; shift 2
  if (cd "$dir" && "$@"); then ok "$label"; else bad "$label"; fi
}

# --- 1. docker compose parses (daemon not required) -------------------------
step "docker compose config"
run "compose config valid" "$ROOT" docker compose config -q

# --- 2. backend -------------------------------------------------------------
if [ -d "$ROOT/backend/node_modules" ]; then
  step "backend: tsc --noEmit"
  run "tsc" "$ROOT/backend" npx tsc --noEmit

  step "backend: eslint"
  run "eslint" "$ROOT/backend" npx eslint .

  step "backend: vitest"
  run "vitest" "$ROOT/backend" npx vitest run
else
  skip "backend/node_modules missing — run: cd backend && npm install"
fi

# --- 3. frontend ------------------------------------------------------------
if [ -d "$ROOT/frontend/node_modules" ]; then
  step "frontend: tsc --noEmit"
  run "tsc" "$ROOT/frontend" npx tsc --noEmit

  step "frontend: eslint"
  run "eslint" "$ROOT/frontend" npx eslint .

  step "frontend: vite build"
  run "vite build" "$ROOT/frontend" npm run build
elif [ -d "$ROOT/frontend" ]; then
  skip "frontend/node_modules missing — run: cd frontend && npm install"
else
  skip "frontend/ not present yet"
fi

# --- result -----------------------------------------------------------------
if [ "$FAIL" -eq 0 ]; then
  printf '\n\033[32m\033[1m✅ verify passed\033[0m\n'
else
  printf '\n\033[31m\033[1m❌ verify failed\033[0m\n'
fi
exit "$FAIL"

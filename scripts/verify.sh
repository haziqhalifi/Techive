#!/usr/bin/env bash
# =============================================================
# HARVEST — single quality gate.
# Mirrors the AGENTS.md pre-commit checklist in one command.
#
#   bash scripts/verify.sh
#
# Runs: compose config -> ruff -> pytest -> red-flag eval
#       -> tsc --noEmit -> eslint -> next build
# =============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FAIL=0

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✔ %s\033[0m\n' "$1"; }
bad()  { printf '\033[31m✖ %s\033[0m\n' "$1"; FAIL=1; }

run() { # run <label> <workdir> <command...>
  local label="$1" dir="$2"; shift 2
  if (cd "$dir" && "$@"); then ok "$label"; else bad "$label"; fi
}

# --- 1. docker compose parses (daemon not required) -------------------------
step "docker compose config"
run "compose config valid" "$ROOT" docker compose config -q

# --- 2. backend -------------------------------------------------------------
PY="$ROOT/backend/.venv/Scripts/python.exe"
[ -x "$PY" ] || PY="$ROOT/backend/.venv/bin/python"

if [ -x "$PY" ]; then
  step "backend: ruff"
  run "ruff check" "$ROOT/backend" "$PY" -m ruff check .

  step "backend: pytest"
  run "pytest" "$ROOT/backend" "$PY" -m pytest -q

  step "backend: red-flag gate eval"
  run "red-flag eval (100% required)" "$ROOT/backend" "$PY" -m evals.redflag_eval
else
  bad "backend venv not found — run: cd backend && python -m venv .venv && python -m pip install -r requirements.txt -r requirements-dev.txt"
fi

# --- 3. frontend ------------------------------------------------------------
if [ -d "$ROOT/frontend/node_modules" ]; then
  step "frontend: tsc --noEmit"
  run "tsc" "$ROOT/frontend" npx tsc --noEmit

  step "frontend: eslint"
  run "eslint" "$ROOT/frontend" npm run lint

  step "frontend: next build"
  run "next build" "$ROOT/frontend" npm run build
else
  bad "frontend node_modules not found — run: cd frontend && npm install"
fi

# --- result -----------------------------------------------------------------
if [ "$FAIL" -eq 0 ]; then
  printf '\n\033[32m\033[1m✅ verify passed\033[0m\n'
else
  printf '\n\033[31m\033[1m❌ verify failed\033[0m\n'
fi
exit "$FAIL"

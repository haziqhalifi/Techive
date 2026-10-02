# Architecture Decision Records

Short records of the decisions that shaped this scaffold, with the reasoning that would otherwise be
lost. Each has a **Why** so a future reader can judge whether it still applies.

---

## ADR-001 — Local Postgres + pgvector in Docker, not Supabase

**Decision.** The demo runs `pgvector/pgvector:pg16` from `docker-compose.yml` on host port 5433.
Supabase is documented as the production path, not wired up.

**Why.** The PRD calls for a PostgreSQL + pgvector pill store. A local container is reproducible,
needs no network or credentials, and lets the schema be applied by `docker-entrypoint-initdb.d` on
first boot. Supabase would add auth and RLS surface area that a 15-day build cannot properly test.

**How to apply.** Host port **5433** avoids clashing with a locally installed Postgres on 5432. Initdb
scripts only run on an **empty** data volume — after editing `data/schema.sql` or `data/seed.sql`, run
`docker compose down -v && docker compose up -d db`.

---

## ADR-002 — No fake Row Level Security locally

**Decision.** Access control lives in `app/core/security.py` (a deny-by-default role dependency) plus
`access_class` checks. No RLS policies are written against a local Postgres.

**Why.** RLS depends on a session identity (`auth.uid()` in Supabase). Writing policies that are not
wired to a real session variable produces the *appearance* of security without the substance, which is
worse than an honest gap. The AGENTS.md stack names Supabase Auth + RLS; that remains the production
migration.

**How to apply.** When moving to Supabase, add `auth.uid()`-based policies per table and drop the
`X-Role` header dependency in favour of a verified JWT.

---

## ADR-003 — The LangGraph pipeline is database-free

**Decision.** `run_case` takes `candidates` and `tenant` in its initial state. The graph never opens a
session.

**Why.** It makes the whole pipeline testable without Postgres, keeps nodes pure and idempotent, and
means the determinism contract can be tested directly. `case_service` is the only module that touches
both the database and the graph.

**How to apply.** New nodes must read from state, not the database. If a node needs new data, load it
in `case_service.list_candidates` and put it in the state.

---

## ADR-004 — `MemorySaver` is not used; the graph is compiled without a checkpointer

**Decision.** `build_graph()` compiles with no checkpointer.

**Why.** A checkpointer serialises state between steps. Our state carries values that should not be
persisted mid-run, and the Postgres checkpointer would add `langgraph-checkpoint-postgres` + psycopg
setup risk for no demo benefit. The audit trail is the durable record of what happened.

**How to apply.** If resumable runs are ever needed, add a checkpointer and make the state JSON-safe
first.

---

## ADR-005 — `asyncpg` as the database driver

**Decision.** `postgresql+asyncpg://` with `asyncpg>=0.31`, pinned in `requirements.txt`.

**Why.** It had a working cp313 win_amd64 wheel, so no compiler is needed on Windows. **`uvloop` is
deliberately never added** — it has no Windows support.

**How to apply.** If a future interpreter has no asyncpg wheel, the fallback is a one-line change to
`postgresql+psycopg://` plus `psycopg[binary]>=3.2`. The note is in `requirements.txt` so the fix is
not re-derived under pressure.

---

## ADR-006 — `LLM_ENABLED=false` stub mode by default

**Decision.** The pipeline runs with no model. `select_pill` falls back to a deterministic choice and
`generated_by` is reported as `stub` on the card.

**Why.** A hackathon demo must not depend on an API key, network, or rate limit. It also makes CI
deterministic and proves the model is genuinely optional — which is the product claim.

**How to apply.** Set `LLM_ENABLED=true` and an `OPENAI_API_KEY` (optionally `OPENAI_BASE_URL` for a
Tencent-compatible endpoint) to enable ranking. The output schema does not change, so nothing else
needs to.

---

## ADR-007 — Hand-written shadcn-style primitives on Tailwind v3.4

**Decision.** Five UI primitives are written by hand. `npx shadcn@latest init` is **not** run.

**Why.** The shadcn CLI now scaffolds Tailwind v4 and applies React 19 codemods, which fights the
chosen stack. Hand-writing `button`, `card`, `badge`, `table` and `separator` keeps the dependency
surface to `class-variance-authority`, `clsx`, `tailwind-merge` and `lucide-react` — no Radix peer-dep
conflicts.

**How to apply.** `tailwind.config.ts` content globs **must** include `./src/**/*.{ts,tsx}`; the app
lives under `src/`, and a wrong glob renders an unstyled page with no error.

---

## ADR-008 — ESLint 8 with `.eslintrc.json`, not flat config

**Decision.** `eslint@^8.57` + `eslint-config-next` via `next lint`.

**Why.** Next 15 still supports it and it is the lowest-friction path. Flat config is the direction of
travel, so this is a known deprecation rather than an oversight.

**How to apply.** Migrating means moving to `eslint.config.mjs` and ESLint 9; budget for that as a
separate change, not a drive-by.

---

## ADR-009 — Ruff for linting, Black for formatting

**Decision.** `ruff check` and `black` are the two commands in `scripts/verify.sh` and CI.

**Why.** It matches the AGENTS.md tool table exactly. Ruff's linter is fast and covers import sorting;
Black owns formatting so there is a single source of truth for style.

**How to apply.** Run `black .` before `ruff check .`. `scripts/verify.sh` and CI run the lint check;
CI fails on either a lint error or an unformatted tree.

---

## ADR-010 — Deterministic synthetic generator with a committed seed

**Decision.** `data/generate_synthetic.py` uses a fixed RNG seed and its outputs (`seed.sql`,
`seed_pills.json`, `seed_tower.json`, `raw/chiller_timeseries.csv`) are committed.

**Why.** Every number in the demo is reproducible and auditable. CI regenerates the data and fails if
the committed files differ, so the seed can never silently drift from the generator.

**How to apply.** Change `SEED` only if you intend to regenerate every committed artifact. Never edit
`data/seed.sql` by hand — it is generated.

---

## Known gaps

- Supabase Auth + RLS (ADR-002).
- pgvector semantic retrieval is wired (column + HNSW index) but not yet used for candidate selection;
  embeddings are NULL in the seed.
- The `apply` / `outcomes` path (recording what actually happened and turning it into a proposed
  version) is modelled in the schema but not exposed in the console.
- No `.Codex/hooks/` directory: the hook scripts described in AGENTS.md are not installed here.

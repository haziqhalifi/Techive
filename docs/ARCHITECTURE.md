# Architecture

HARVEST is a governed **Intelligence Pill** platform. The single most important design rule is
that **numbers and safety never touch the language model**.

```
┌──────────────────────────┐        ┌────────────────────────────┐        ┌──────────────────────┐
│  Next.js 15 console      │  HTTP  │  FastAPI + LangGraph       │  SQL   │  PostgreSQL +        │
│  (App Router, RSC)       │ ─────▶ │  deterministic core        │ ─────▶ │  pgvector            │
│                          │        │  + red-flag gate           │        │  pills, cases,       │
│  decision card           │ ◀───── │  + agent graph             │ ◀───── │  hash-chained audit  │
└──────────────────────────┘        └────────────────────────────┘        └──────────────────────┘
```

## 1. The determinism contract

| Concern | Module | LLM allowed |
|---|---|---|
| Red-flag gate (FR-08) | `services/gate_service.py` | **No** — pure rules, runs first |
| Case parsing | `agents/nodes.py::parse_case` | **No** — regex + enums |
| Context check (FR-09) | `services/context_check.py` | **No** — pure comparison |
| Metrics (FR-04) | `services/analytics.py` | **No** — pure maths |
| Claim validation (FR-02) | `services/pill_service.py` | **No** |
| Audit chain (FR-11) | `services/audit_service.py` | **No** |
| Pill ranking (FR-05) | `agents/nodes.py::select_pill` | **Yes** — returns `{selected_pill_id}` only |
| Rationale | `services/llm.py` | **Yes** (optional) — rationale *codes* only |

Two guards keep this honest:

1. **`tests/test_no_llm_in_deterministic.py`** parses the AST of every deterministic module and fails
   the build if it imports `app.services.llm`, a model provider SDK, or an agent framework.
2. **`services/llm.py` is the only module that may import a provider SDK** — a second test scans the
   whole `app/` tree and asserts this.

`services/llm.py` no-ops when `LLM_ENABLED=false`, so the hero case runs end-to-end with **no API
key**. The model's output schema is `{selected_pill_id, rationale_codes}`; the ID is validated
against the candidate set, and an invalid ID falls back to a deterministic choice. Numbers are
injected into the card by `analytics.py` *after* selection.

## 2. The agent graph

```
START → parse_case → evaluate_gate
                        ├─ escalate → escalate_case → END
                        └─ continue → check_context
                                        ├─ blocked → block_case → END
                                        └─ ok → select_pill → compute_metrics
                                                    → assemble_card → route_action → END
handle_error  ← reached whenever state["error"] is set
```

- Nodes are `verb_noun`, single responsibility, and return full state (`{**state, ...}`).
- Every node is wrapped to log entry/exit/latency and to set `state["error"]` on failure. A node that
  runs after an upstream failure is skipped rather than run on a broken state.
- Invoked with `config={"recursion_limit": 10}`.
- `VALID_ROUTES` is derived from the `Route` enum; a router may only return one of those values.

**Safety ordering is structural, not procedural**: `evaluate_gate` runs before `select_pill`, so a
red-flag case cannot reach a model. A test asserts this by monkeypatching the model call to raise.

### The graph is database-free

`candidates` (approved pills, shaped for the model) and `tenant` are loaded by
`services/case_service.py` and injected into the initial state. This keeps the entire pipeline
testable without Postgres — see `tests/test_graph_hero.py` and `tests/test_seed_hero_case.py`.

## 3. Data model

```
app_users ──< user_roles
tenants ──────────────────────────┐
transcript_excerpts ──┐           │
pills ──< pill_versions ──< claims│
                    └────< pill_options
cases ──< decision_options ──< outcomes
audit_logs  (append-only, hash-chained)
```

Key constraints that encode product rules in the database:

- `claims`: `CHECK (kind = 'unknown' OR source_excerpt_id IS NOT NULL)` — FR-02 cannot be bypassed
  even by a direct write.
- `pill_options.source_excerpt_id` — FR-06 provenance for every option.
- `audit_logs`: a `BEFORE UPDATE OR DELETE` trigger raises, so the trail is append-only at the DB
  layer as well as in the service.

`transcript_excerpts.embedding` is `vector(1536)` with an HNSW index — pgvector is wired so pills can
later be retrieved by meaning rather than keyword. The seed leaves embeddings NULL; the skeleton
selects candidates by approved status and context, not by vector search.

### The audit hash chain

```
hash = sha256(prev_hash + canonical_json(action, entity_type, entity_id, payload, occurred_at))
```

Genesis uses `prev_hash = "0" * 64`. Appends take a Postgres advisory lock so concurrent writers
cannot fork the chain. `audit_service.verify_chain` is pure and unit-tested (tamper, reorder, and
delete cases all fail verification).

## 4. API surface

| Method + path | Purpose |
|---|---|
| `GET /api/v1/health`, `/health/db` | liveness / DB reachable |
| `GET /api/v1/pills`, `/pills/{id}` | approved list / detail with versions + evidence |
| `POST /api/v1/pills/{id}/approve` \| `/reject` \| `/rollback` | FR-03 / FR-10 lifecycle |
| `POST /api/v1/cases` | run the pipeline, persist, return the decision card |
| `GET /api/v1/cases`, `/cases/{id}` | recent cases / decision card |
| `GET /api/v1/demo/hero-case` | the pre-filled synthetic hero complaint |
| `POST /api/v1/agents/run` | invoke the graph with explicit state (demo/debug) |
| `GET /api/v1/audit` | read-only hash-chained trail + chain validity |

**Access is deny-by-default.** No real auth locally: the console sends `X-Role` / `X-User-Id`. A
missing or unrecognised role is rejected with 403 before any handler runs.

## 5. Where to look first

| Question | File |
|---|---|
| How are numbers computed? | `backend/app/services/analytics.py` |
| How do safety cases bypass the AI? | `backend/app/services/gate_service.py` |
| What can the model actually do? | `backend/app/services/llm.py`, `agents/prompts.py` |
| How is the graph wired? | `backend/app/agents/graph.py`, `agents/nodes.py` |
| How is tampering detected? | `backend/app/services/audit_service.py` |
| What does the DB enforce? | `data/schema.sql` |
| What does the card show? | `frontend/src/components/decision-card.tsx` |

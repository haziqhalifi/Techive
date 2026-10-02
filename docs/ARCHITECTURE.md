# Architecture

VERDANT is a governed **Intelligence Pill** platform. The single most important design rule is
that **numbers and safety never touch the language model**.

```
┌──────────────────────────┐        ┌────────────────────────────┐        ┌──────────────────────┐
│  Vite + React 19         │  HTTP  │  Express + TypeScript      │        │  In-memory store     │
│  console                 │ ─────▶ │                            │ ─────▶ │                      │
│                          │        │  deterministic core        │        │  seeded from one     │
│  case console            │ ◀───── │  + red-flag gate           │ ◀───── │  RNG seed            │
│  pill library            │        │  + 8-node pipeline         │        │                      │
│  capture interview       │        │                            │        │  ┌────────────────┐  │
│  transfer check          │        │  model boundary is one     │        │  │ Postgres +     │  │
│  audit log               │        │  function in one file      │        │  │ pgvector       │  │
└──────────────────────────┘        └────────────────────────────┘        │  │ (optional,     │  │
                                                                          │  │  not wired)    │  │
                                                                          │  └────────────────┘  │
                                                                          └──────────────────────┘
```

## 1. The determinism contract

| Concern | Module | LLM allowed |
|---|---|---|
| Red-flag gate (FR-08) | `modules/cases/gate.service.ts` | **No** — pure regex + one numeric band check |
| Case parsing | `modules/cases/orchestrator.ts` → `parseCase` | **No** — regex + enums |
| Context check (FR-09) | `modules/cases/orchestrator.ts` → `checkContext` | **No** — pure comparison |
| Metrics (FR-04) | `modules/analytics/analytics.service.ts` | **No** — pure maths |
| Claim validation (FR-02) | `modules/pills/pill.service.ts` | **No** |
| Audit chain (FR-11) | `modules/audit/audit.service.ts` | **No** |
| Retrieval | `modules/pills/retrieval.service.ts` | **No** — weighted token overlap |
| Pill selection (FR-05) | `modules/pills/model.ts` | **Yes** — returns one candidate ID |

Three properties keep this honest:

1. **The model boundary is one file.** `modules/pills/model.ts` is the only module that performs
   network I/O to a provider. Nothing else imports it except `modules/pills/orchestrator.ts`.
2. **The model cannot introduce an ID.** `choosePill` builds an `allowed` set from the retrieved
   candidates; a response whose `pill_version_id` is not in that set falls back to the top-scoring
   candidate. A malformed response, a timeout, or a non-2xx status all fall back the same way.
3. **`LLM_ENABLED=false` is the default**, so the hero case and the whole test suite run with no API
   key and no network. The fallback path *is* the tested path.

Numbers are injected into the card by `analytics.service.ts` *after* selection, from raw telemetry —
never from the model, and never typed into a fixture.

## 2. The decision pipeline

`modules/cases/orchestrator.ts`:

```
parse_case → evaluate_gate ─┬─ escalate ────────────────────────────────→ end
                            └─ check_context ─┬─ blocked ───────────────→ end
                                              └─ select_pill
                                                 → validate_context ─┬─ blocked → end
                                                                     └─ compute_metrics
                                                                        → assemble_card
                                                                        → route_action
```

- Node names follow `verb_noun`, each with a single responsibility.
- `MAX_HOPS = 10` mirrors a graph `recursion_limit`; a node that would exceed it throws
  `PipelineError` rather than looping.
- Every node appends a `Hop { node, status, latencyMs, note }` to the card, so the card carries its
  own execution trace.
- **Safety ordering is structural, not procedural.** `evaluate_gate` runs before `select_pill`, so a
  red-flag case cannot reach a model. An escalated card is observably inert: `selection: null`,
  `metrics: null`, `options: []`, and the hop log stops at `escalate`.
- **The card is re-derived, not cached.** `GET /api/cases/:id` re-runs the pipeline with
  `persist: false`. This means a pill library change is reflected in an existing case, and there is
  no second rendering path that could disagree with the first.

### Why a hand-rolled pipeline instead of LangGraph

The pipeline is a fixed, acyclic, deterministic sequence with three early exits. Expressing that as
data (a node table) would have added a dependency and a serialisation boundary without buying
anything: there is no dynamic routing, no checkpointing, and no need to resume mid-run. The
`PipelineState` type and the `Hop` log preserve the properties that mattered — single responsibility,
explicit state, observable hops, a hard hop ceiling.

## 3. Data model

The in-memory store (`shared/store.ts`) holds one `StoreState`:

```
sites ──< assets
      └─< tenants
users
readings                     (1,344 × 15-minute chiller samples)
transcript_excerpts ──┐
pills ──< pill_versions ──< claims
                       └──< pill_options
cases ──< decision_options
      └─< outcomes
audit_logs                   (append-only, hash-chained)
counters                     (deterministic ID allocation)
```

`data/schema.sql` holds the equivalent durable Postgres + pgvector schema, including the constraints
that encode product rules at the storage layer:

- `claims`: `CHECK (kind = 'unknown' OR source_excerpt_id IS NOT NULL)` — FR-02 cannot be bypassed
  even by a direct write.
- `audit_logs`: a `BEFORE UPDATE OR DELETE` trigger raises, so the trail is append-only in the
  database as well as in the service.
- `transcript_excerpts.embedding` is `vector(1536)` with an HNSW index.

That path is **defined but not wired** — see "Known gaps" in `README.md`.

### Determinism

`shared/rng.ts` implements `mulberry32`. **`Math.random` is never called anywhere in this codebase.**
The whole world derives from `VERDANT_SEED` (default `20261002`), and `shared/store.ts` exposes a
settable clock (`setClock`) so seeded timestamps are reproducible. A test re-seeds and asserts the
serialised world is byte-identical.

The chiller series is generated *to a target*: each day's mean walks linearly from 0.6230 to 0.7130
kW/RT, and the per-reading noise is zero-mean **within each day**, so the daily means land on the
target line regardless of the random draw. `analytics.summariseReadings` recovers those numbers from
the raw series, which is why the card's figures are derived rather than asserted.

### The audit hash chain

```
hash = sha256(prevHash + canonicalJson(action, entityType, entityId, payload, occurredAt))
```

Genesis uses `prevHash = "0".repeat(64)`. `canonicalJson` sorts object keys recursively, so two
logically equal payloads always hash identically regardless of construction order. `verifyAudit()`
re-derives every hash **and** checks that `seq` is contiguous, so an edit, a reorder or a deletion all
fail verification and report the first broken `seq`. There is no update or delete function, and none
is exported.

## 4. API surface

See the table in `README.md`. The shape of the contract:

- Errors always leave as `{ error: { code, message, details } }`. `middleware/errorHandler.ts` is the
  single place that renders them; a `ZodError` becomes a 422, a `VerdantError` carries its own status,
  and anything else becomes a 500 with no stack trace leaked.
- Validation happens at the boundary with Zod (`middleware/validation.ts`); services then enforce
  *governance* rules (FR-02, FR-03) that validation cannot express.
- **Access is deny-by-default.** `modules/governance/roles.ts` holds the role → permission matrix;
  every service calls `assertCan`, so an unrecognised role is denied even if a route forgets to check.
  Locally there is no password flow — `middleware/actor.ts` resolves the caller from
  `x-verdant-user` or `x-verdant-role`.

## 5. Where to look first

| Question | File |
|---|---|
| How are numbers computed? | `backend/src/modules/analytics/analytics.service.ts` |
| How do safety cases bypass the AI? | `backend/src/modules/cases/gate.service.ts` |
| What can the model actually do? | `backend/src/modules/pills/model.ts` |
| How is the pipeline wired? | `backend/src/modules/cases/orchestrator.ts` |
| How is tampering detected? | `backend/src/modules/audit/audit.service.ts` |
| What can each role do? | `backend/src/modules/governance/roles.ts` |
| What does the DB enforce? | `data/schema.sql` |
| Where does the world come from? | `backend/src/modules/synthetic/world.dataset.ts` |

# VERDANT — Tower K Energy & Comfort Pill

> When Tower K's chief engineer retires, his judgement on cooling and comfort stays —
> approved, versioned and measurable.

A governed **Intelligence Pill** platform for a synthetic Singapore Grade-A office tower.
Built for the **Tencent Cloud AI CAN DO IT Hackathon SG 2026** (Real Estate / Keppel, AI HARVEST).

**Core principle:** the AI never writes guidance. It selects an approved pill *by ID*, every
number is computed **deterministically in code**, and a human approves anything that acts.

---

## The hero case

A tenant on Level 23 reports *"too hot"* at 14:40. Over two weeks the chiller plant's efficiency
has quietly drifted from **0.6230 → 0.7130 kW/RT**. The intuitive fix is to drop the building-wide
chilled-water setpoint — which over-cools every floor and *raises* energy cost.

The pill prices both moves and refuses the wrong one:

| Option | SGD delta | Policy tier | Outcome |
|---|---|---|---|
| Re-sequence chiller staging (lead/lag rotation) | **−1285.20** | Lease comfort | **Selected** |
| Clean condenser tubes on the lag chiller | −504.00 | Energy target | Ranked below |
| **Drop building-wide chilled-water setpoint to 6.0 °C** | **+642.60** | Energy target | **Rejected** |
| Night purge via AHU economiser cycle | −252.00 | Preference | Ranked below |

The card states the rejection in policy terms rather than hiding it:
*"Rejected 'Drop building-wide chilled-water setpoint to 6.0 °C': it breaches the energy-target
policy tier and would raise cost by SGD 642.60."*

---

## Architecture

```
Vite + React 19 console  ──HTTP──▶  Express + TypeScript API  ──▶  In-memory store
(case console, pill library,        (deterministic core,           (seeded from one RNG seed;
 capture interview, transfer         red-flag gate, 8-node         Postgres + pgvector is the
 check, audit log)                   pipeline)                     optional durable path)
```

The data layer is **in-memory by default** — one process, one seeded world, no external services
required to run the demo. `data/schema.sql` holds the equivalent durable Postgres + pgvector schema
for the production path, which is not yet wired to the API (see [Known gaps](#known-gaps)).

### Determinism contract

The single most important design rule: **numbers and safety never touch the LLM.**

| Concern | Module | LLM allowed |
|---|---|---|
| Red-flag gate (FR-08) | `backend/src/modules/cases/gate.service.ts` | **No** — pure regex + a numeric band check |
| Case parsing | `backend/src/modules/cases/orchestrator.ts` → `parseCase` | **No** — regex + enums |
| Context check (FR-09) | `backend/src/modules/cases/orchestrator.ts` → `checkContext` | **No** — pure comparison |
| Metrics (FR-04) | `backend/src/modules/analytics/analytics.service.ts` | **No** — pure maths |
| Claim validation (FR-02) | `backend/src/modules/pills/pill.service.ts` | **No** |
| Audit hash chain (FR-11) | `backend/src/modules/audit/audit.service.ts` | **No** |
| Pill retrieval | `backend/src/modules/pills/retrieval.service.ts` | **No** — weighted token overlap |
| Pill **selection** (FR-05) | `backend/src/modules/pills/model.ts` | **Yes** — returns one candidate ID |

`backend/src/modules/pills/model.ts` is the **only** module that talks to a model provider. Its
contract is deliberately tiny: given a case and a ranked candidate list, return the ID of exactly
one candidate. It cannot compute a number, write guidance, or introduce an ID that retrieval did
not supply — a hallucinated or malformed response falls back to the top-scoring candidate.

With `LLM_ENABLED=false` (the demo and CI default) that module never performs I/O, so the hero case
runs end-to-end **with no API key**.

### The decision pipeline

```
parse_case → evaluate_gate ─┬─ escalate ────────────────────────────────→ end
                            └─ check_context ─┬─ blocked ───────────────→ end
                                              └─ select_pill
                                                 → validate_context ─┬─ blocked → end
                                                                     └─ compute_metrics
                                                                        → assemble_card
                                                                        → route_action
```

- Node names follow `verb_noun`. `MAX_HOPS = 10` mirrors the graph's `recursion_limit`; exceeding it
  throws rather than looping.
- **Safety ordering is structural, not procedural**: `evaluate_gate` runs before `select_pill`, so a
  red-flag case can never reach a model — or a number. The escalated card carries `selection: null`,
  `metrics: null`, `options: []`.
- The card is produced by *re-running* the deterministic pipeline, not by caching a snapshot, so a
  pill library change is reflected in an existing case and there is no second code path to drift.

### The audit hash chain

```
hash = sha256(prevHash + canonicalJson(action, entityType, entityId, payload, occurredAt))
```

Genesis uses `prevHash = "0".repeat(64)`. Canonical JSON sorts keys recursively, so two logically
equal payloads always hash the same. `verifyAudit()` re-derives the chain and also checks that the
sequence is contiguous, so an edit, a reorder or a deletion all fail verification and report the
first broken `seq`.

---

## Quickstart

**Prerequisites:** Node 20+ (Node 24 recommended). No database, no API key, no Docker required.

### 1. Backend

```bash
cd backend
npm install
npm run dev          # http://localhost:8000
```

The world seeds itself on boot: 3 sites, 62 assets, 8 leases, 1,344 chiller readings, 6 pills
(5 approved + 1 draft) and a hash-chained audit trail.

```bash
curl -s http://localhost:8000/api/health
curl -s http://localhost:8000/api/seed/status
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

### 3. Run the hero case

```bash
curl -s -X POST http://localhost:8000/api/cases \
  -H "content-type: application/json" \
  -H "x-verdant-role: aom" \
  -d '{
    "siteId": "site-towerk",
    "floor": 23,
    "zone": "North",
    "symptom": "Level 23 is too hot and stuffy at 14:40",
    "description": "Tenant reports 26.5 C against a target of 23 C. Building-wide chiller plant efficiency has drifted from 0.62 to 0.71 kW/RT over the past two weeks."
  }' | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,2)))"
```

---

## Demo script (5 minutes)

1. **Problem** — Tower K's retrofit "reads as an aggregate success": nobody can say which lever
   worked, and the person who knows is retiring.
2. **Capture** — the chief engineer's guided interview drafts a pill; every claim is pinned to a
   verbatim quote from his transcript (FR-02), and he cannot approve his own pill (FR-03).
3. **Hero incident** — the complaint arrives, the red-flag gate passes, code computes the kW/RT
   drift from raw telemetry, and the card rejects the building-wide setpoint drop.
4. **Governed learning** — a revision is drafted, the live version is untouched until a reviewer
   approves it, and a regression can be rolled back.
5. **Transfer refused** — applying the Tower K pill to Harbourfront One is blocked on
   `chiller_plant`, `tariff` and `gfa_sqm` mismatches (FR-09).
6. **Why it's not a chatbot** — humans approve, numbers come from code, versions roll back, and the
   audit chain proves the record was never edited.

---

## Roles (deny by default)

| Role | Can do | Cannot do |
|---|---|---|
| Asset Operations Manager | Run cases, approve execute-tier actions, record outcomes | Edit or approve pills |
| Chief Engineer (pill owner) | Run capture interviews, draft and revise own pills | Approve their own pill |
| Pill Reviewer | Approve, reject, roll back, sign off cross-site transfer | Run live cases on assets they review |
| Site Operator / Technician | Read approved pills, log observations and outcomes | See drafts or lease data |
| Governance Admin | View the audit log, export pills, re-seed | Change pill content |

Policy hierarchy for conflicts: **Safety > Statutory > Lease comfort terms > Energy targets > Preferences.**

Access is deny-by-default: an unknown or missing role is rejected. Locally there is no password flow
— the caller identifies itself with a header, and every service calls `assertCan`:

```bash
curl -s http://localhost:8000/api/audit -H "x-verdant-role: site_operator"     # 403
curl -s http://localhost:8000/api/audit -H "x-verdant-role: governance_admin"  # 200
```

---

## Verification

```bash
bash scripts/verify.sh
```

Runs: `tsc --noEmit` · `eslint` · `vitest run` for the backend, then `tsc --noEmit` · `eslint` ·
`vite build` for the frontend.

---

## API surface

| Method + path | Purpose |
|---|---|
| `GET /api/health` | liveness, seed, LLM mode |
| `GET /api/roles` | roles, labels and permissions (drives the role switcher) |
| `GET /api/analytics/metrics` · `/readings` | the card's numbers + priced levers · the time series |
| `GET /api/sites` · `/assets` · `/tenants` | reference data |
| `GET /api/pills` · `/pills/:id` | library list · detail with claims and provenance |
| `GET /api/pills/eval` | retrieval precision/recall over the historical ticket set |
| `POST /api/pills` | capture a pill from an interview (chief engineer) |
| `POST /api/pills/:pillId/revise` | create version n+1 as a draft (owner) |
| `POST /api/pills/:pillVersionId/submit` \| `/approve` \| `/reject` | review lifecycle |
| `POST /api/pills/:pillId/rollback` | re-activate an earlier approved version |
| `POST /api/cases` | run the pipeline, persist, return the decision card |
| `GET /api/cases` · `/cases/:id` | recent cases · re-derive the decision card |
| `POST /api/cases/:caseId/outcome` | close the loop with what actually happened |
| `GET /api/audit` · `/audit/verify` | read-only hash-chained trail + chain validity |
| `POST /api/seed` · `GET /api/seed/status` | rebuild the world (governance admin) · counts |

Errors always leave in one shape:

```json
{ "error": { "code": "forbidden", "message": "...", "details": { "role": "site_operator" } } }
```

---

## Repository layout

```
backend/    Express + TypeScript API: deterministic services, 8-node pipeline, tests
frontend/   Vite + React 19 console (case console, pill library, capture, transfer, audit)
data/       schema.sql — the durable Postgres + pgvector schema (optional path, not yet wired)
docs/       Architecture, decisions, hero case, build log
scripts/    verify.sh
```

---

## Known gaps

- **The Postgres path is defined but not wired.** `data/schema.sql` holds the durable schema and
  `docker-compose.yml` can start pgvector, but the API reads and writes the in-memory store only.
- **pgvector semantic retrieval is not implemented.** `transcript_excerpts.embedding` is modelled as
  `vector(1536)`; retrieval is currently weighted token overlap.
- **No auth.** Roles are asserted from a request header, not a verified JWT.
- **Outcomes are recorded but not fed back.** `POST /api/cases/:caseId/outcome` stores what happened;
  turning that into a proposed revision is manual.
- **The model boundary is implemented but unexercised in CI.** `LLM_ENABLED=false` means the
  fallback path is what the test suite covers.

---

## Data notice

**All data is synthetic and labelled as such on every screen and export.** No real Keppel or
personal data is used. The chiller series is generated deterministically from a fixed RNG seed
(`VERDANT_SEED`, default `20261002`) — `Math.random` is never called anywhere in this codebase, and
a test asserts that re-seeding produces a byte-identical world. Public datasets (ASHRAE Great Energy
Predictor III, BCA) inform realistic baselines only.

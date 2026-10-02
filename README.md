# HARVEST — Tower K Energy & Comfort Pill

> When Tower K's chief engineer retires, his judgement on cooling and comfort stays —
> approved, versioned and measurable.

A governed **Intelligence Pill** platform for a synthetic Singapore Grade-A office tower.
Built for the **Tencent Cloud AI CAN DO IT Hackathon SG 2026** (Real Estate / Keppel, AI HARVEST).

**Core principle:** the AI never writes guidance. It selects an approved pill *by ID*, every
number is computed **deterministically in code**, and a human approves anything that acts.

---

## The hero case

A tenant on Level 23 reports *"too hot"* at 2:40pm. Over two weeks the chiller plant's efficiency
has quietly drifted from **0.62 → 0.71 kW/RT**. A junior engineer's instinct is to lower the
building-wide setpoint — which fixes one zone and wastes energy across the whole tower.

The pill stops that, ranks the real cause, and recommends a **zone-level fix** (inspect the L23 VAV
damper; re-sequence chillers *with approval*), attributing the kWh saved to the correct lever.

---

## Architecture

```
Next.js 15 console  ──HTTP──▶  FastAPI + LangGraph  ──▶  PostgreSQL + pgvector
(dashboard, decision card,      (deterministic core,        (pills, versions, claims,
 pill detail, audit log)         red-flag gate, graph)       cases, hash-chained audit)
```

### Determinism contract

The single most important design rule: **numbers and safety never touch the LLM.**

| Concern | Module | LLM allowed |
|---|---|---|
| Red-flag gate (FR-08) | `services/gate_service.py` | **No** — runs before any LLM call |
| Case parsing | `agents/nodes.py::parse_case` | **No** |
| Context check (FR-09) | `services/context_check.py` | **No** |
| Metrics (FR-04) | `services/analytics.py` | **No** — pure math |
| Claim validation (FR-02) | `services/pill_service.py` | **No** |
| Audit hash chain (FR-11) | `services/audit_service.py` | **No** |
| Pill ranking | `agents/nodes.py::select_pill` | Yes — returns `{selected_pill_id}` only |
| Rationale | `services/llm.py` | Yes (optional) — rationale *codes* only |

`services/llm.py` is the only module that may import an LLM SDK, and it no-ops when
`LLM_ENABLED=false` — so the hero case runs end-to-end **with no API key**.
An architecture test (`tests/test_no_llm_in_deterministic.py`) fails CI if an LLM import appears
in a deterministic module.

### Agent graph

```
START → parse_case → evaluate_gate
                        ├─ escalate → escalate_case → END
                        └─ continue → check_context
                                        ├─ blocked → block_case → END
                                        └─ ok → select_pill → compute_metrics
                                                    → assemble_card → route_action → END
```

Invoked with `recursion_limit=10`. Node names follow `verb_noun`.

---

## Quickstart

**Prerequisites:** Docker Desktop (running), Python 3.13, Node 20+.
On Windows use `python` (not `python3`).

### 1. Database

```bash
docker compose up -d db
docker compose exec db psql -U harvest -d harvest -c "\dt"
```

### 2. Backend

```bash
cd backend
python -m venv .venv
source .venv/Scripts/activate     # Windows Git Bash  (Linux/macOS: source .venv/bin/activate)
python -m pip install -r requirements.txt -r requirements-dev.txt
python -m uvicorn app.main:app --reload --port 8000
```

Health: <http://localhost:8000/api/v1/health> · API docs: <http://localhost:8000/docs>

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

Console: <http://localhost:3000/dashboard> → **Run hero case**.

---

## Demo script (5 minutes)

1. **Problem** — Keppel Bay Tower's retrofit "reads as an aggregate success": nobody can say which
   lever worked, and the person who knows is retiring.
2. **Capture** — the chief engineer's guided interview drafts a pill; every claim links to his words.
3. **Hero incident** — the complaint arrives, the red-flag gate passes, code computes the kW/RT
   drift, and the card recommends the zone fix (not a building-wide setpoint drop).
4. **Governed learning** — a proposed v1.3 fails one comfort eval case; the reviewer rolls back.
5. **Transfer refused** — applying the pill to Tower B is blocked on context mismatch.
6. **Why it's not a chatbot** — humans approve, numbers come from code, versions roll back.

---

## Roles (deny by default)

| Role | Can do | Cannot do |
|---|---|---|
| Asset Operations Manager | Run cases, approve execute-tier actions, record outcomes | Edit/approve pills |
| Chief Engineer (pill owner) | Run capture interviews, draft/revise own pills | Approve own pill |
| Pill Reviewer | Approve, reject, retire, roll back, sign off transfers | Run live cases |
| Site Operator / Technician | Read approved pills, log observations | See drafts or lease data |
| Governance Admin | Manage roles, view audit, export pills | Change pill content |

Policy hierarchy for conflicts: **Safety > Statutory > Lease comfort terms > Energy targets > Preferences.**

---

## Verification

```bash
bash scripts/verify.sh
```

Runs: `docker compose config` · `ruff check` · `pytest` · red-flag eval · `tsc --noEmit` ·
`eslint` · `next build`.

---

## Repository layout

```
backend/    FastAPI app, deterministic services, LangGraph agents, tests, evals
frontend/   Next.js 15 console (dashboard, decision card, pill detail, audit log)
data/       SQL schema, deterministic synthetic generator, seed data
docs/       Architecture, decisions, hero case, CodeBuddy log
scripts/    verify.sh
```

---

## Data notice

**All data is synthetic and labelled as such on every screen and export.** No real Keppel or
personal data is used. Chiller series are generated deterministically from published efficiency
curves; public datasets (ASHRAE Great Energy Predictor III, BCA) inform realistic baselines only.

# Architecture Decision Records

Short records of the decisions that shaped this build, with the reasoning that would otherwise be
lost. Each has a **Why** so a future reader can judge whether it still applies.

---

## ADR-001 — The in-memory store is the primary data layer; Postgres is the durable path

**Decision.** `shared/store.ts` holds one mutable `StoreState` in process memory, seeded from a fixed
RNG seed on boot. `data/schema.sql` holds the equivalent Postgres + pgvector schema, and
`docker-compose.yml` can start it under a `postgres` profile — but the API does not read or write it.

**Why.** The demo's value is in the governance model, not the database driver. An in-memory store
means `npm install && npm run dev` produces a complete, populated system with no external service, no
credentials and no network. It also makes the test suite fast and fully deterministic, which is what
lets the determinism contract actually be enforced in CI rather than asserted in a README.

**How to apply.** The Postgres path is a real commitment, not a gesture: `data/schema.sql` is
maintained and carries the FR-02 and append-only constraints at the storage layer. If you wire it up,
the repository interfaces in each module (`asset.repository.ts`, `pill.repository.ts`,
`case.repository.ts`, `audit.service.ts`) are the seam — they are already the only code that touches
collections directly. Until then, be honest in the README that it is unwired.

---

## ADR-002 — Express + TypeScript, not FastAPI + Python

**Decision.** The backend is Express 4 + TypeScript (strict) on Node 20+, run with `tsx` in dev.

**Why.** The frontend is TypeScript. A single language means the domain types, the API contract and
the UI are one mental model, and the shared vocabulary (`PillVersion`, `DecisionOption`,
`ContextCheckResult`) is written once instead of mirrored across a serialisation boundary. The
hackathon budget also favours one toolchain over two.

**How to apply.** `backend/tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters` and
`verbatimModuleSyntax`. The last one means type-only imports **must** use `import type` — this is not
stylistic, it is what keeps the store's type imports erased at runtime so `shared/store.ts` has no
runtime dependency on the feature modules (the arrow points one way: services → store).

---

## ADR-003 — A hand-rolled pipeline, not LangGraph

**Decision.** `modules/cases/orchestrator.ts` implements the pipeline as an explicit `async` function
with a `step()` helper and a `PipelineState` object. No graph library.

**Why.** The pipeline is a fixed, acyclic, deterministic sequence with three early exits. There is no
dynamic routing, no checkpointing, and no need to resume mid-run — so a graph library would have
added a dependency, an async runtime and a serialisation boundary without buying anything. The
properties that actually mattered are preserved directly: single-responsibility nodes, explicit
state, an observable hop log, and a hard hop ceiling (`MAX_HOPS = 10`) that throws instead of looping.

**How to apply.** Node names follow `verb_noun`. A new node must read from `PipelineState`, not from
the store directly, and must append exactly one hop. If you ever need genuinely dynamic routing or
resumable runs, revisit — but the current shape is not an accident.

---

## ADR-004 — The model boundary returns exactly one candidate ID

**Decision.** `modules/pills/model.ts` exposes one function, `choosePill(caseText, candidates)`. It
returns `{ pillVersionId, reason, modelAssisted }`, where `pillVersionId` must be one of the supplied
candidates.

**Why.** This is the product claim made executable. The model cannot compute a number, cannot write
guidance, and cannot invent an ID. The `allowed` set is built from the retrieved candidates, so a
hallucinated ID, a malformed JSON body, a timeout and a non-2xx response all fall back to the
top-scoring candidate — meaning the system behaves identically with the model on or off, just with a
different `reason` string and a different `modelAssisted` flag.

**How to apply.** If you extend what the model does, extend the *validation* first. Any new field the
model may emit must be validated against a closed set derived from state, never trusted.

---

## ADR-005 — The red-flag gate is pure regex, severity-ordered, and runs before everything

**Decision.** `modules/cases/gate.service.ts` evaluates a fixed rule list ordered
safety → legionella → illness → odour → setpoint band, plus one numeric out-of-band setpoint check.
The first match wins. It runs before retrieval, before selection and before any number is computed.

**Why.** A missed red flag is a safety incident; a false positive is an extra phone call. The
asymmetry means every rule errs toward escalating, and recall — not precision — is the metric. Order
by severity means a case that is both "smell" and "smoke" reports the more serious category. Running
first is what makes the guarantee structural: an escalated card has `selection: null` and
`metrics: null`, so a red flag can never be buried under a plausible-looking cost analysis.

**How to apply.** The setpoint rule deliberately ignores chilled-water setpoints (a 6 °C chilled-water
setpoint is normal; a 6 °C *space* setpoint is not), and ignores values outside 10–35 °C so it only
fires on plausible space setpoints. When adding a rule, add a negative fixture to
`tickets.dataset.ts::GATE_NEGATIVE_FIXTURES` in the same commit — the test suite runs both lists.

---

## ADR-006 — A revision is a draft until a reviewer approves it

**Decision.** `capturePill` creates version 1. `revisePill` creates version n+1 with status `draft`
and `supersedesVersionId` pointing at the previous version — and it does **not** change the pill's
`currentVersionId`. Only `approvePill` promotes a version to live, superseding the previous one.

**Why.** Editing the library must never silently change what the pipeline retrieves. If a revision
went live on write, a chief engineer's in-progress edit would immediately alter the advice given on
live cases. Making the promotion explicit means the governance step is the only thing that changes
behaviour, which is also what makes rollback meaningful.

**How to apply.** `rollbackPill` re-activates an earlier approved version and marks the current one
`superseded` — history is never rewritten. `getPillDetail(pillId, versionId?)` takes an optional
version so the capture/revise endpoints can return the draft they just created while
`GET /api/pills/:id` returns the live one.

---

## ADR-007 — One seed, and `Math.random` is never called

**Decision.** The entire synthetic world derives from `VERDANT_SEED`. `shared/rng.ts` provides
`mulberry32` and an `Rng` class; `shared/store.ts` provides a settable clock.

**Why.** Every number in the demo is quoted in a PRD. If the data were random, the hero card would
be unreproducible and the docs would rot. Determinism also makes the audit chain testable with exact
hashes and lets CI fail on any drift.

**How to apply.** Change the seed only if you intend to regenerate every quoted figure, including
`docs/HERO_CASE.md` and the README's lever table. The chiller series is generated to a target —
per-reading noise is zero-mean *within each day*, so daily means land on the target line regardless
of the draw. Never edit a generated figure by hand; derive it.

---

## ADR-008 — Pills are published through the real governance path at seed time

**Decision.** `runSeed()` does not insert "approved" rows. It calls `capturePill` → `submitForReview`
→ `approvePill` for each seeded pill, with the chief engineer as author and a *different* person as
reviewer.

**Why.** A seed that bypasses the rules proves nothing about the rules. Publishing through the real
path means FR-02 (every non-unknown claim cites a verbatim transcript excerpt) and FR-03 (an author
may never approve their own pill) are exercised on every single boot. If a seeded pill's transcript
and its claims disagree, the seed fails loudly instead of producing a broken demo.

**How to apply.** `runSeed` also asserts that each declared seed `slug` matches `slugify(title)`,
because the eval ticket set references pills by slug. This guard exists because it was needed: two
declared slugs silently disagreed with their titles, and the only symptom was a retrieval eval
scoring 0.58 instead of 1.0.

---

## ADR-009 — Zod at the boundary, one error shape, deny-by-default in the service

**Decision.** Controllers validate request bodies with Zod (`middleware/validation.ts`).
`middleware/errorHandler.ts` is the only place errors are rendered, always as
`{ error: { code, message, details } }`. Permissions are enforced in the *service* via `assertCan`,
not in the route.

**Why.** Validation and governance are different concerns. Zod can say "this string is too long"; it
cannot say "an author may not approve their own pill". Putting permission checks in services means a
new route cannot forget one — and a `ZodError` becoming a 422, a `VerdantError` carrying its own
status, and everything else becoming a stack-trace-free 500 is decided in exactly one function.

**How to apply.** Never `res.status(...).json(...)` an error in a controller — throw. Use
`asyncHandler` on any async route; Express 4 does not forward rejected promises to the error
middleware, so an unwrapped async handler hangs the socket.

---

## ADR-010 — Hash chain with canonical JSON and a contiguous sequence check

**Decision.** `hash = sha256(prevHash + canonicalJson(...))`, genesis `prevHash = "0".repeat(64)`.
`verifyAudit()` re-derives every hash *and* asserts `seq === index + 1`.

**Why.** Hashing alone catches edits, but not a deletion that happens to leave the remaining links
self-consistent — the sequence check closes that. Canonical JSON (recursive key sort) means the hash
commits to the *meaning* of a payload, not the order its keys happened to be built in, so a refactor
that reorders object literals does not break the chain and does not produce a false tamper alert.

**How to apply.** There is no update or delete function for audit entries, and none is exported.
Never add one. If a payload legitimately changes, append a new entry.

---

## ADR-011 — Hand-written shadcn-style primitives on Tailwind

**Decision.** The frontend ships a small set of hand-written UI primitives rather than running the
shadcn CLI.

**Why.** The shadcn CLI now scaffolds Tailwind v4 and applies React 19 codemods, which fights a
Vite + React 19 + Tailwind v3 setup. Hand-writing the primitives keeps the dependency surface small
and avoids Radix peer-dependency conflicts, which is a real cost on a short build.

**How to apply.** `tailwind.config.ts` content globs must include `./src/**/*.{ts,tsx}`. The app lives
under `src/`, and a wrong glob renders an unstyled page with no error — budget for that if the
styling ever "disappears".

---

## Known gaps

- The Postgres + pgvector path is defined (`data/schema.sql`) but not wired to the API (ADR-001).
- pgvector semantic retrieval is modelled but not implemented; retrieval is weighted token overlap.
- No auth: roles come from a request header, not a verified JWT. `assertCan` is the real gate.
- Outcomes are recorded but not fed back into a proposed revision automatically.
- The model boundary is implemented but unexercised in CI, because `LLM_ENABLED=false` means the
  fallback is the tested path (ADR-004).

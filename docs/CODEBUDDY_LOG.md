# CodeBuddy build log (FR-12)

> **Submission requirement.** The organiser handbook requires **at least 3 screenshots, or a
> recording, of the CodeBuddy / WorkBuddy build chats**, kept in the repository.
>
> This file is the index for that evidence. Replace the placeholders below with real captures before
> submitting — **do not fabricate them.**

## How to capture

1. Keep this session's CodeBuddy transcript open.
2. Capture the moments that show *engineering judgement*, not just code appearing. The most
   compelling frames are the ones where the tool disagreed with the first approach, where a test
   caught a real bug, or where a blocker was reported honestly rather than worked around.
3. Save screenshots under `docs/evidence/` (create the folder) and reference them here.
4. Prefer full-window captures that show the prompt, the tool's reasoning, and the diff.

## Suggested captures (all of these actually happened in this build)

| # | Moment | Why it is worth showing |
|---|---|---|
| 1 | The stack pivot: the FastAPI + Next.js scaffold was **committed** (`93d1558`) before being replaced, rather than overwritten | Destructive change handled by preserving, not discarding, prior work |
| 2 | Docker Desktop failing with *"There is not enough space on the disk"*, root-caused to ~4.5 GB free on `C:` | An environment blocker reported honestly instead of hidden |
| 3 | `tsc` error: *"This comparison appears to be unintentional because the types … have no overlap"* after the second `state.route === "blocked"` check | TypeScript's property narrowing persisted across a function call; the fix funnels the read through `isBlocked(state)` |
| 4 | The retrieval eval reporting **0.5833** instead of 1.0, root-caused to two declared seed slugs disagreeing with `slugify(title)` | The eval harness caught a real bug that no unit test would have |
| 5 | The fix: a seed-time assertion that each declared slug matches `slugify(title)` | Turning a one-off bug into a permanent guard |
| 6 | The live API returning the hero card: `route: execute_with_approval`, setpoint option `selected: false`, `policyNote` naming the rejection | The product claim, demonstrated end to end |

## Evidence log

| Date | Tool | What was done | Artefact |
|---|---|---|---|
| 2026-10-02 | CodeBuddy | Scaffolded the FastAPI + Next.js stack (100 files, 16,261 insertions); committed as `93d1558` | `git show 93d1558 --stat` |
| 2026-10-02 | CodeBuddy | Docker/disk blocker: Postgres smoke test deferred; reported, not worked around | *(screenshot pending)* |
| 2026-10-02 | CodeBuddy | Pivoted to Express + TypeScript + in-memory store; built 49 files / ~4,900 lines with 74 tests | `git log`, `backend/src/**` |
| 2026-10-02 | CodeBuddy | Fixed the slug/title mismatch found by the retrieval eval; added a seed-time guard | `backend/src/modules/synthetic/seed.controller.ts` |
| 2026-10-02 | CodeBuddy | Verified end to end: hero card, gate escalation, transfer block, 403 on audit, eval 1.0 | `docs/HERO_CASE.md` |

## WorkBuddy

The PRD lists WorkBuddy as **optional**, suggested for running the capture interview. It was **not**
used. If it is added, log those captures here too and note what it contributed — the handbook scores
the proof, not the tool choice.

## Repo evidence that is already committed

Independent of screenshots, the repository itself evidences the build:

- `git log` — the scaffold commit, then the pivot.
- `backend/src/__tests__/` — 74 tests: gate recall, audit tamper detection, FR-02/FR-03 governance,
  pipeline exits, determinism, and the HTTP surface.
- `backend/src/modules/pills/eval.service.ts` + `synthetic/tickets.dataset.ts` — the retrieval eval,
  with deliberately colliding pills so it has to discriminate.
- `backend/src/modules/cases/gate.service.ts` + `tickets.dataset.ts::GATE_POSITIVE_FIXTURES` — the
  FR-08 gate and its recall fixture.
- `.github/workflows/ci.yml` — the gate that runs on every push.
- `docs/DECISIONS.md` — the reasoning behind eleven architectural choices.

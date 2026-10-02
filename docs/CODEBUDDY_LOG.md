# CodeBuddy / WorkBuddy build log (FR-12)

> **Submission requirement.** The organiser handbook requires **at least 3 screenshots, or a
> recording, of the CodeBuddy / WorkBuddy build chats**, kept in the repository.
>
> This file is the index for that evidence. Replace the placeholders below with real captures before
> submitting — **do not fabricate them.**

## How to capture

1. Keep this session's CodeBuddy transcript open.
2. Capture the moments that show *engineering judgement*, not just code appearing. The most
   compelling frames are the ones where the tool disagreed with the first approach, or where a test
   caught a real bug.
3. Save screenshots under `docs/evidence/` (create the folder) and reference them here.
4. Prefer full-window captures that show the prompt, the tool's reasoning, and the diff.

## Suggested captures (all of these actually happened in this build)

| # | Moment | Why it is worth showing |
|---|---|---|
| 1 | Scaffolding plan being agreed before any file was written | Shows planning and scope control, not blind generation |
| 2 | `test_audit_chain` failing with `'str' object has no attribute 'tzinfo'` | A real bug the test suite caught in the hash chain |
| 3 | The red-flag eval reporting `escalation recall: 100.0%` after the water-ingress regex fix | The gate genuinely failing before it passed |
| 4 | The architecture test rejecting `langgraph` in a deterministic module, then the fix separating *model providers* from *orchestration frameworks* | Governance enforced by CI, not by convention |
| 5 | `next build` output listing all 6 routes | The console actually building |
| 6 | Docker Desktop failing with "not enough space on the disk" | Honest recording of an environment blocker |

## Evidence log

| Date | Tool | What was done | Artefact |
|---|---|---|---|
| 2026-10-02 | CodeBuddy | Full scaffold: monorepo, deterministic core, LangGraph pipeline, Next.js console, CI | *(screenshot pending)* |
|  |  |  |  |

## WorkBuddy

The PRD lists WorkBuddy as **optional**, suggested for running the capture interview. It was **not**
used in this scaffold. If it is added, log those captures here too and note what it contributed —
the handbook scores the proof, not the tool choice.

## Repo evidence that is already committed

Independent of screenshots, the repository itself evidences the build:

- `git log` — commit history of the scaffold.
- `backend/evals/redflag_eval.py` + `backend/evals/cases/redflag_cases.jsonl` — the FR-08 eval.
- `backend/tests/test_no_llm_in_deterministic.py` — the architecture guard.
- `.github/workflows/ci.yml` — the gate that runs on every push.
- `docs/DECISIONS.md` — the reasoning behind ten architectural choices.

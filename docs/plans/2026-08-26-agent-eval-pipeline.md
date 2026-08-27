# Implementation Plan: Agent Eval Pipeline

## Overview
Port the lab's proven eval methodology into the product plane: turn a reviewer's real accept/dismiss
decisions on findings into frozen `eval_cases`, run an agent across its cases through the **real
`reviewer-core` engine** (frozen inputs, context enrichment off, grounding gate on), score
recall / precision / citation-accuracy **purely in code**, and surface regressions in an Evals tab, a
compare view, and a cross-agent Eval Dashboard. Sourced from `specs/2026-08-26-agent-eval-pipeline.md`
(SPEC-2026-08-26-agent-eval-pipeline); this plan does not redefine that scope.

## Execution mode
**multi-agent (parallel)** — recommended default. The feature spans four packages and many independent
surfaces (scoring core, server module, five client surfaces, seed). The plan is phased with a strict
dependency DAG and **non-overlapping `Owned paths`** so several `implementer` agents can run
concurrently on the same branch. It also executes correctly top-to-bottom as single-agent (the DAG is
a valid linear order). **Confirmed by the user (2026-08-27): multi-agent (parallel).**

## Requirements (verified)
Grounding was verified against the live code before planning. Confirmations:
- `eval_cases` / `eval_runs` exist and are **entirely unused** in `server/src` (grep: zero references
  outside `db/schema/eval.ts` + the vendor barrel). `eval_runs` has **no `batch_id` and no
  `agent_version`** — Q1 is real (`server/src/db/schema/eval.ts:22-37`).
- Shared eval contracts exist as claimed: `EvalCaseInput`, `EvalRunRecord`, `EvalRunResult`,
  `EvalDashboard`, `EvalTrendPoint` (`server/src/vendor/shared/contracts/eval-ci.ts`); `EvalRun`,
  `EvalCase`, `EvalOwnerKind` (`.../knowledge.ts`). `EvalRunRecord` carries **no** version/batch id
  (Q1) and `EvalDashboard.recent_runs` is `EvalRunRecord[]` — per-case, not batch (Q2).
- `reviewPullRequest(input): ReviewOutcome` (`reviewer-core/src/review/run.ts:128`). `ReviewOutcome`
  exposes **both** `review` (grounded/kept findings) **and** `dropped[]` (with reasons), plus
  `costUsd|null`, `tokensIn/Out`, `grounding` string. **No `duration_ms`** — the caller times it
  (`server/.../run-executor.ts` uses `Date.now()`). Context enrichment is disabled simply by
  **omitting** `callers`/`repoMap`/`intent`/`specs` (no flag). `wrapUntrusted` + the injection guard
  run **inside** the engine (AC-41/42 for free). `groundFindings` is mandatory/always-on.
- Findings model confirmed: `findings.{file,start_line,end_line,severity,category,title,accepted_at,
  dismissed_at}`; `findings.reviewId → reviews.agentId` (owning agent) and `reviews.workspaceId`
  (workspace scope) — `server/src/db/schema/reviews.ts:28-46`.
- `agents.version` + `agent_versions.config_json` snapshots confirmed; written by
  `snapshotVersion()` (config keys `provider, model, system_prompt, output_schema, strategy,
  ci_fail_on, repo_intel, skills[ids]`), read by `getVersion(agentId, version)`
  (`server/src/modules/agents/repository.ts:148-187`). Reviews today use the **live** agent row.
- Module registration is static in `server/src/modules/index.ts`; workspace id via
  `getContext(app.container, req)`; rate limit via per-route `config.rateLimit`; container repos are
  lazy getters; services are per-request `new XService(container)`.
- Client scaffolding partly present: `client/messages/en/eval.json` (dashboard/caseEditor/evalsTab/
  page namespaces) and `agents.json` `editor.tabs.evals: "Evals"` already exist;
  `activeKeyFor` already maps `/eval` → `"eval"` (`client/src/components/app-shell/helpers.ts:36`).

Requirements restated as checkable items (traced to AC-numbers throughout the tasks):
- **R-A (Capability A / AC-1..6):** one-click "Turn into eval case" from a decided finding; derive
  `must_find`/`must_not_flag` from decision; freeze `input_diff`; case survives source deletion.
- **R-B (B / AC-7..11):** AgentEditor Evals tab lists cases with status/summary; CRUD + run-single +
  run-all; validate `expected_output`; "Run on save".
- **R-C (C / AC-12..19):** batch run over every case through `reviewPullRequest` with frozen diff,
  context off, current version snapshot, grounding on; empty-set rejection; per-case failure isolation.
- **R-D (D / AC-20..27):** pure deterministic scorer — overlap match rule, micro-averaged
  recall/precision/citation, per-case pass, vacuous-denominator rules, bounds.
- **R-E (E / AC-28..31):** persist per-case metrics; batch-level metrics + deltas + run history + trend.
- **R-F (F / AC-32..35):** compare two batches → metric deltas + system-prompt diff + mismatch notice.
- **R-G (G / AC-36..39):** cross-agent Eval Dashboard under SKILLS LAB + "Run all agents" (bounded).
- **R-H (H / AC-40..43):** workspace-scoped endpoints; untrusted-wrapped inputs; grounding never
  bypassed; rate-limited runs; bounded run-all.
- **R-I (I / AC-44):** seeded sensitivity experiment proving precision drops on a corrupted prompt.
- **R-NFR:** determinism (no LLM in scoring), comparability, a11y (no colour-only status), i18n.

> **User decisions locked in (2026-08-27):** execution = **multi-agent (parallel)**; **Q1** = add the
> batch/version columns; **Q4** = strict per-case pass; **Q5** = **wire a minimal Promote vN** (agents
> module — see T17); **Q2/Q3/Q6** as recommended below. Only **Q6 alert** remains a soft default
> (deterministic, no model) and is non-blocking.

## Open questions & recommendations

- **Q1 — batch grouping + version linkage on `eval_runs`.** **Rec (RECOMMENDED, spec-aligned): add
  nullable `batch_id uuid` + `agent_version integer` columns to `eval_runs` via a new own-migration.**
  Bucketing by `(owner_id, ran_at)` is fragile (concurrent batches collide — see Q3); stuffing ids
  into `actual_output`/`input_meta` is unqueryable. The server convention explicitly permits new
  columns in your own migration (`server/CLAUDE.md`: "new columns = your own migration only"), and
  `db:generate` produces the migration file (no hand-editing of `db/migrations/`). This is a
  prerequisite for correct run-history rows, the RECENT-RUNS "VERSION" column, and compare's
  "v6 → v7". → **T2.**
- **Q2 — dashboard `recent_runs` granularity.** **Rec: keep the fixed `EvalDashboard` contract as-is
  for `current`/`delta`/`trend`, and carry batch rows in a NEW `EvalBatchRow` contract** (added as a
  new shared file, not an edit to the existing one). Do **not** overload the per-case
  `EvalDashboard.recent_runs`; the per-agent run history (AC-31) and cross-agent recent runs (AC-37)
  use `EvalBatchRow[]`. Depends on Q1. → **T1, T7.**
- **Q3 — concurrent batches / single-flight.** **Rec: proceed WITHOUT single-flight (matches the
  spec's accepted stance).** Each batch gets its own `batch_id` and is independent. Cost is bounded by
  rate-limits (AC-43) and by "Run all agents" being bounded. Low-risk; not a blocker.
- **Q4 — per-case pass threshold.** **Rec: keep AC-25 strict (per-case recall = 1 AND precision = 1).**
  Strictness is what makes a `must_not_flag` noise finding fail the case and makes the AC-44 precision
  drop observable. Proceeding strict; confirm if you intended "all expected found, noise allowed".
- **Q5 — "Promote vN". USER DECISION: wire a minimal promote (not deferred).** No "set active version /
  revert to vN" capability exists in the agents module today (only forward version bumps on config
  change), so we add one — in the **agents module** (spec N5 says promotion is an agents-module concern,
  not evals). **Minimal, non-destructive semantics (reuses existing machinery, invents nothing):**
  promoting vN reads `AgentsRepository.getVersion(id, N).config_json` and feeds those config fields back
  through the existing `AgentsService.update()` — which naturally bumps to a *new* version whose config
  equals vN's and snapshots it (forward-only history preserved; no row is mutated in place). **Critical
  trap (verified in code):** `update()` does **not** touch `agent_skills`, so the promote path must
  **also** call `setSkills(id, snapshot.config_json.skills)` to re-apply the snapshot's skill links, or
  the promoted agent silently keeps the current skill set. The compare view's "Promote vN" control is
  **enabled** and calls this endpoint. → **T17 (agents module, new), T12 (client wiring).**
- **Q6 — dashboard `alert` copy.** **Rec: generate deterministically from metric deltas, no model**
  (e.g. `precision` delta < 0 → "Precision dipped {n}pt on v{version}"). Cheap, pure, honours N3.
  Left `null` when no notable delta. → **T7.**
- **Rec (contracts do-not-touch):** the batch/compare/dashboard shapes go in a **new** file
  `contracts/eval-batch.ts` because `server/src/vendor/shared/` is do-not-touch-without-coordination
  and **adding a new contract file is the sanctioned path** (CLAUDE.md), whereas editing
  `eval-ci.ts`/`knowledge.ts` ripples across packages. The new file + its one barrel export line must
  be mirrored into the client vendor copy (`client/src/vendor/shared/contracts/`) — the accepted
  "client mirrors shared contracts" drift. → **T1.**
- **Rec (agent config for a run):** use the `agent_versions.config_json` snapshot for the current
  version (AC-15); it stores skill **IDs**, so re-resolve skill **bodies** at run time via
  `container.agentsRepo.linkedSkills`. Fall back to the live `agents` row when no snapshot exists,
  still recording the current version (AC-16).

## Affected modules & contracts
- **`@devdigest/shared` (server + client vendor mirror)** — **add** one new file `eval-batch.ts`
  (`EvalBatchRow`, `EvalCompareResult`, `EvalAgentSummary`, `EvalDashboardCross`, `ExpectedFinding`);
  reuse existing `EvalCaseInput`/`EvalCase`/`EvalRun`/`EvalRunRecord`/`EvalRunResult`/`EvalDashboard`/
  `EvalTrendPoint`. **Do not edit** existing eval contract files.
- **server `db`** — edit `schema/eval.ts` (+`db/rows.ts` if a row type is derived) to add nullable
  `batch_id` + `agent_version` to `eval_runs`; generate a migration.
- **server (new `evals` module)** — `modules/evals/` (repository, sub-services, sub-route plugins,
  helpers); one line in `modules/index.ts`; one lazy getter in `platform/container.ts`.
- **server (existing `agents` module) — EDIT for Promote vN (Q5):** add `promoteToVersion` to
  `modules/agents/service.ts` + a `POST /agents/:id/promote` route in `modules/agents/routes.ts`
  (reuses `repository.getVersion` + `service.update` + `service.setSkills`). No new module.
- **reviewer-core** — **consumed unchanged**; **add** a pure scorer file (`src/eval/score.ts`) that
  stays pure (its neighbours: `grounding.ts`). Placement here (vs. server) keeps scoring next to the
  grounding it mirrors; either is spec-permitted — this plan puts it in reviewer-core.
- **client (`@devdigest/web`)** — new hooks file, Evals tab, case editor, compare view, finding action,
  Eval Dashboard page + sidebar entry; reuse the existing `eval.json` i18n namespace.
- **Contracts:** new files to add — `eval-batch.ts` (both vendor copies). No existing shared contract
  is edited (only the barrel gains one export line — flagged as the coordination point).

## Architecture changes
- **reviewer-core `src/eval/score.ts`** (Core layer) — pure function
  `scoreEvalCase(expected: ExpectedFinding[], produced: Finding[], candidateCount: number)` +
  `aggregateBatch(perCase[])`; no I/O, no LLM (mirrors `groundFindings` purity). Exported from
  `reviewer-core/src/index.ts`.
- **server `modules/evals/`** (onion): `repository.ts` = **only** file touching `db/schema` (eval_cases
  + eval_runs); `capture.service.ts`, `run-executor.ts`, `dashboard.service.ts`, `cases.service.ts` =
  Application (depend on `container`/ports, never on `src/adapters/**` directly); `*.routes.ts` =
  Presentation (Zod schema → `getContext` → one service call). The module's `routes.ts` index
  registers the four sub-route plugins.
- **server `run-executor.ts`** must: parse `input_diff` via `container.git`/`parseUnifiedDiff` →
  `UnifiedDiff`; resolve `llm = await container.llm(cfg.provider)`; call `reviewPullRequest({
  systemPrompt, model, strategy, skills, diff, llm })` with **no** enrichment fields; time it with
  `Date.now()`; compute `candidateCount = review.findings.length + dropped.length`.
- **client** — new client components are `"use client"` (interactivity + TanStack hooks); the Eval
  Dashboard route entry (`app/eval/page.tsx`) can be a thin server component rendering a
  `"use client"` view (mirror `app/skills/page.tsx`).

## Shared server conventions (apply to every backend task)
- Route params use the shared `IdParams = z.object({ id: z.string().uuid() })` from
  `server/src/modules/_shared/schemas.ts`; response schemas import from `@devdigest/shared`, request
  bodies are local `const` Zod schemas; opt into validation with `.withTypeProvider<ZodTypeProvider>()`.
- `getContext(app.container, req)` yields `{ workspaceId, userId }` (no decorator/preHandler); throw
  `NotFoundError` from `platform/errors.js` for cross-workspace / missing resources (AC-40); creates
  reply with `reply.status(201)`.
- The "base-repository guard" is a **convention, not a class**: every query on a workspace-owned table
  manually `and(eq(t.<table>.workspaceId, workspaceId), …)`. `eval_cases` has `workspace_id`;
  `eval_runs` is scoped transitively via `case_id → eval_cases`. Only `repository.ts` imports
  `db/schema` + `drizzle-orm`.
- ESM `.js` import extensions are required on TS source throughout.

## Phased tasks

```mermaid
flowchart TD
  subgraph P0[Phase 0 — Substrate]
    T1[T1 contracts eval-batch.ts]
    T2[T2 eval_runs migration]
  end
  subgraph P1[Phase 1 — Scoring core]
    T3[T3 pure scorer + tests]
  end
  subgraph P2[Phase 2 — Server module skeleton]
    T4[T4 evals module + repo + wiring]
  end
  subgraph P3[Phase 3-4 — Server features]
    T5[T5 capture from finding]
    T6[T6 run-executor + batch run]
    T7[T7 dashboard/history/compare]
    T8[T8 case CRUD + single run]
  end
  subgraph P5[Phase 5 — Client]
    T9[T9 evals hooks]
    T10[T10 Evals tab]
    T11[T11 case editor]
    T12[T12 compare view]
    T13[T13 finding action]
    T14[T14 dashboard page + nav]
  end
  subgraph PA[Phase 2b — Promote vN (agents module, parallel)]
    T17[T17 agents promoteToVersion + route + hook]
  end
  subgraph P6[Phase 6-7 — Harden + seed]
    T15[T15 security/a11y/i18n tests]
    T16[T16 seed + AC-44 experiment]
  end
  T1 --> T4 --> T5
  T1 --> T9
  T2 --> T6
  T3 --> T6
  T4 --> T6 --> T7
  T6 --> T8
  T1 --> T7
  T9 --> T10 & T11 & T13 & T14
  T9 --> T12
  T17 --> T12
  T7 --> T15
  T14 --> T15
  T17 --> T15
  T15 --> T16
```

**T17 has no dependency on the evals tasks** (it edits the pre-existing agents module) and owns paths
disjoint from every evals task, so it runs in parallel from the start; only the client compare view
(T12) joins the two by depending on both T9 (hooks) and T17 (endpoint).

### Phase 0 — Contracts & schema substrate (foundation)

- **T1 — New shared batch/compare/dashboard contracts (+ client mirror)**
  - **Action:** Add `contracts/eval-batch.ts` defining: `ExpectedFinding` (`{ severity, category,
    title, file, start_line, end_line? }` — the AC-10 finding-skeleton), `EvalBatchRow`
    (`batch_id, agent_id, agent_version, ran_at, recall, precision, citation_accuracy, traces_passed,
    traces_total, cost_usd`), `EvalCompareResult` (`older: EvalBatchRow`, `newer: EvalBatchRow`,
    `deltas`, `prompt_diff: {added:string[],removed:string[]} | null`, `trace_count_notice: string |
    null`), `EvalAgentSummary` (`agent_id, name, model, latest: EvalBatchRow | null, trend:
    EvalTrendPoint[]`), `EvalDashboardCross` (`agents: EvalAgentSummary[]`, `recent_batches:
    EvalBatchRow[]`). Add **one** re-export line to the shared barrel. Copy the identical file +
    barrel line into the client vendor mirror.
  - **Module:** server + client (shared vendor) · **Type:** core (contracts)
  - **Skills to use:** `zod`, `typescript-expert`
  - **Owned paths:** `server/src/vendor/shared/contracts/eval-batch.ts`,
    `server/src/vendor/shared/contracts/index.ts` (barrel export line only),
    `client/src/vendor/shared/contracts/eval-batch.ts`,
    `client/src/vendor/shared/contracts/index.ts` (barrel export line only)
  - **Depends-on:** none
  - **Risk:** medium (touches do-not-touch `vendor/shared` — but only via a *new* file + one export)
  - **Known gotchas:** `vendor/shared` is do-not-touch-without-coordination; adding a new file is the
    sanctioned path — do NOT edit `eval-ci.ts`/`knowledge.ts`. Client keeps a *mirror* copy that must
    stay byte-identical (accepted drift gotcha). Verify the exact barrel file name/path before editing.
  - **Acceptance:** `cd server && npx tsc --noEmit` and `cd client && npx tsc --noEmit` pass; `import
    { EvalBatchRow } from '@devdigest/shared'` resolves in both packages; existing eval contracts are
    unchanged (`git diff --stat` shows only additions to the two new files + one barrel line each).

- **T2 — Add `batch_id` + `agent_version` to `eval_runs` (own-migration)**
  - **Action:** In `db/schema/eval.ts` add `batchId: uuid('batch_id')` and `agentVersion:
    integer('agent_version')` (both nullable) to `evalRuns`; add an index on `batch_id`. Run
    `npm run db:generate` to emit a new migration SQL file (do not hand-write it). Update `db/rows.ts`
    if an `EvalRunRow` type is derived there.
  - **Module:** server (`db`) · **Type:** backend (schema/migration)
  - **Skills to use:** `drizzle-orm-patterns`, `postgresql-table-design`
  - **Owned paths:** `server/src/db/schema/eval.ts`, `server/src/db/rows.ts`,
    `server/src/db/migrations/**` (generated file only)
  - **Depends-on:** none
  - **Risk:** medium
  - **Known gotchas:** never hand-edit `db/migrations/` — use `db:generate`. Migration order is by
    `meta/_journal.json`, **not** by filename number — duplicate-numbered orphan files from parallel
    branches already exist; do not renumber them. Per `server/INSIGHTS.md` the journal is out of sync;
    integration tests use `drizzle-kit push --force` + `CREATE EXTENSION vector`. Nullable columns keep
    the add a fast, non-rewriting DDL.
  - **Acceptance:** a new migration file appears under `db/migrations/`; `cd server && npm run
    typecheck` passes; a query selecting `evalRuns.batchId`/`.agentVersion` type-checks; existing
    migrations untouched.

### Phase 1 — Scoring core (pure) — Capability D

- **T3 — Pure deterministic scorer in reviewer-core**
  - **Action:** Add `reviewer-core/src/eval/score.ts`: `matches(expected, produced)` (AC-20 overlap:
    same `file` AND `max(startₑ,startₐ) ≤ min(endₑ,endₐ)`, single-line → `[l,l]`, severity/category/
    title ignored); `scoreCase(expected, produced, candidateCount)` → per-case `{recall, precision,
    citation_accuracy, pass}` (AC-21/22/23 fractions, AC-24 vacuous → 1.0, AC-25 strict pass);
    `aggregateBatch(cases[])` → micro-averaged `{recall, precision, citation_accuracy, traces_passed,
    traces_total, cost_usd}` (AC-26, AC-29 sum, AC-27 bounds). No I/O, no LLM. Export from
    `reviewer-core/src/index.ts`. Add `score.test.ts` covering AC-20/21/22/23/24/25/27 (incl.
    must_not_flag noise and vacuous cases).
  - **Module:** reviewer-core · **Type:** core
  - **Skills to use:** `typescript-expert`, `react-testing-library` (vitest patterns only)
  - **Owned paths:** `reviewer-core/src/eval/score.ts`, `reviewer-core/src/eval/score.test.ts`,
    `reviewer-core/src/index.ts` (one export line)
  - **Depends-on:** none (can start immediately; consumes `Finding` type + `ExpectedFinding` from T1
    — if run before T1, define `ExpectedFinding` locally and swap the import when T1 lands)
  - **Risk:** low
  - **Known gotchas:** citation-accuracy denominator is the pre-grounding **candidate** count =
    `kept + dropped` (the caller supplies it; the scorer does not re-ground). Keep the function pure —
    reviewer-core must not import `db`/`fastify`/adapters (onion core rule).
  - **Acceptance:** `cd reviewer-core && npx vitest run src/eval/score.test.ts` green; tests assert
    `recall 2/3`, `precision 0.8`, `citation 0.95`, vacuous → `1.0`, must_not_flag+1-finding fails,
    every metric ∈ [0,1], re-scoring identical inputs yields identical output.

### Phase 2 — Server evals module skeleton + repository

- **T4 — `evals` module scaffold, repository, container + registry wiring**
  - **Action:** Create `modules/evals/repository.ts` (`EvalsRepository(db)`) with all data access,
    workspace-scoped by ANDing `evalCases.workspaceId` (and joining `eval_cases` for `eval_runs`
    scope): `createCase`, `getCase`, `listCasesForOwner`, `updateCase`, `deleteCase`, `insertRun`,
    `listRunsForCase`, `listRunsForAgent`, `listBatches(agentId)`, `getBatch(batchId)`,
    `latestBatchPerAgent(workspaceId)`. Create `helpers.ts` (row→DTO mappers) and `constants.ts`.
    Create the module index `routes.ts` that registers the four sub-route plugins (files created in
    Phase 3-4). Add a lazy `evalsRepo` getter in `platform/container.ts`; add `evals` to
    `modules/index.ts`.
  - **Module:** server (`modules/evals`) · **Type:** backend
  - **Skills to use:** `onion-architecture`, `drizzle-orm-patterns`, `fastify-best-practices`
  - **Owned paths:** `server/src/modules/evals/repository.ts`,
    `server/src/modules/evals/helpers.ts`, `server/src/modules/evals/routes.ts`,
    `server/src/modules/evals/constants.ts`, `server/src/platform/container.ts` (add getter),
    `server/src/modules/index.ts` (add one entry)
  - **Depends-on:** T1
  - **Risk:** medium
  - **Known gotchas:** `repository.ts` is the ONLY evals file allowed to import `db/schema`
    (onion rule). `eval_runs` has no `workspace_id` — scope it via join to `eval_cases`.
    `getFinding` is not workspace-scoped by itself; the capture service must verify ownership
    (see T5). Module registration is static — one line in `modules/index.ts`, no autoload; use `.js`
    import extensions.
  - **Acceptance:** `cd server && npm run typecheck` passes; app boots with the module registered
    (`cd server && pnpm test` existing suite still green); the four sub-route imports resolve as stubs.

### Phase 2b — Promote vN (agents module) — Capability F (Q5, user-approved)

- **T17 — `promoteToVersion` in the agents module + route + client hook**
  - **Action:** **(server)** Add `AgentsService.promoteToVersion(workspaceId, id, version)` in
    `modules/agents/service.ts`: load the target snapshot via `repository.getVersion(id, version)`
    (→ `NotFoundError` if absent or agent is out-of-workspace, AC-40); map its `config_json`
    (`provider, model, system_prompt, output_schema, strategy, ci_fail_on, repo_intel`) into an
    `UpdateAgentInput` patch and call the existing `update()` (bumps to a NEW version equal to the
    snapshot's config + snapshots it — forward-only, non-destructive); **then** call `setSkills(id,
    config_json.skills)` to re-apply the snapshot's skill links (**the verified trap: `update()` never
    touches `agent_skills`**). Return the updated `Agent`. Add `POST /agents/:id/promote` (body `{
    version: z.number().int().positive() }`, workspace-scoped, `getContext`) in
    `modules/agents/routes.ts`. **(client)** Add `usePromoteAgentVersion()` to `hooks/agents.ts`
    (`api.post(\`/agents/${id}/promote\`, { version })`), invalidating the agent + eval-dashboard keys.
  - **Module:** server (`modules/agents`) + client (agents hook) · **Type:** backend + ui
  - **Skills to use:** `onion-architecture`, `fastify-best-practices`, `zod`, `security`,
    `react-best-practices`
  - **Owned paths:** `server/src/modules/agents/service.ts`, `server/src/modules/agents/routes.ts`,
    `client/src/lib/hooks/agents.ts`
  - **Depends-on:** none (edits the pre-existing agents module; independent of every evals task)
  - **Risk:** medium — **scope crossing:** spec N5 puts promotion out of the *evals* feature and in the
    agents module; this task honours that boundary (the logic lives in `agents`, evals never mutates a
    version). The only real hazard is the `agent_skills` re-apply — an implementer who forgets it ships
    a promote that silently keeps the wrong skills. It is called out as an explicit sub-step **and** an
    acceptance assertion below so it cannot be missed.
  - **Known gotchas:** reuse `update()` + `setSkills()` — do NOT write a bespoke agents mutation or
    touch `agent_versions` directly. `update()` only bumps the version when `isConfigChange` sees a
    config delta; promoting a version whose config already equals the live config is a no-op bump — the
    endpoint should still succeed idempotently (return the current agent). `.js` ESM import extensions.
  - **Acceptance:** integration test (`server/test/agents-promote.it.test.ts`) — create an agent, edit
    it (→ v2 with skill set A), edit again (→ v3 with skill set B), `POST /agents/:id/promote {version:
    2}` → agent's live config + **linked skills** match the v2 snapshot (asserts `linkedSkills` == set
    A, proving the re-apply), a new version row exists (forward-only), and a cross-workspace agent id →
    not-found (AC-40); `cd client && npx tsc --noEmit` passes with the new hook.

### Phase 3-4 — Server features (parallel after T4/T6)

- **T5 — Capture: create eval case from a finding — Capability A**
  - **Action:** `capture.service.ts` + `capture.routes.ts`. Route (e.g. `POST
    /findings/:id/eval-case`): `getContext` → load finding → its `review` (→ `agentId`,
    `workspaceId`); verify the agent is in the caller's workspace (else `NotFoundError`, AC-40). If both
    `accepted_at` and `dismissed_at` are null → reject with a "decide first" response (AC-4). Derive:
    accepted → `must_find`, `expected_output = [{severity,category,title,file,start_line,end_line}]`
    (AC-2); dismissed → `must_not_flag`, `expected_output = []`, record file+range in `input_meta`/
    `notes` (AC-3). Freeze `input_diff` = a synthetic unified-diff fragment covering the finding's file
    + a hunk spanning `start_line..end_line` (AC-5). Insert an `eval_cases` row (`owner_kind='agent'`,
    `owner_id=agentId`, `workspaceId`) via `EvalsRepository.createCase`. Store an optional
    `input_meta.expectation` discriminator (`must_find`/`must_not_flag`) for display clarity.
  - **Module:** server (`modules/evals`) · **Type:** backend
  - **Skills to use:** `onion-architecture`, `fastify-best-practices`, `zod`, `security`
  - **Owned paths:** `server/src/modules/evals/capture.service.ts`,
    `server/src/modules/evals/capture.routes.ts`
  - **Depends-on:** T4
  - **Risk:** medium
  - **Known gotchas:** the case is a **snapshot** — it must not FK-cascade off the finding; store the
    frozen diff so deleting the finding/review/PR leaves the case runnable (AC-6). `input_diff` must
    parse via `parseUnifiedDiff` to a `UnifiedDiff` whose files include the finding's file and whose
    hunk covers the range (grounding uses `hunk.newLineNumbers`).
  - **Acceptance:** integration test (`*.it.test.ts`) — accepted finding on `src/config.ts:12` → case
    with `expected_output[0].file="src/config.ts"`, `start_line=12`, `owner_id===review.agentId`
    (AC-1,2); dismissed → `expected_output=[]` + meta records file:line (AC-3); undecided → no row +
    prompt (AC-4); `parseUnifiedDiff(case.input_diff)` includes the file+hunk (AC-5); deleting the
    finding leaves the case row/`input_diff` unchanged (AC-6); a cross-workspace finding id → not-found
    (AC-40).

- **T6 — Run-executor + batch run — Capability C (+ per-case persistence)**
  - **Action:** `run-executor.ts` + `run.routes.ts`. Route (`POST /agents/:id/eval-runs`, rate-limited):
    `getContext` → verify agent in workspace → load all cases (`listCasesForOwner`); if zero → reject
    "no cases to run", write nothing (AC-18). Else mint a `batch_id` (uuid) + resolve `agent_version =
    agents.version`; load `getVersion(agentId, version)` snapshot config (fallback to live agent row if
    absent, AC-16). For **each** case: `parseUnifiedDiff(input_diff)` → `UnifiedDiff`; resolve skill
    bodies from snapshot skill IDs via `container.agentsRepo.linkedSkills`; `llm = await
    container.llm(cfg.provider)`; time+call `reviewPullRequest({ systemPrompt, model, strategy, skills,
    diff, llm })` with **no** `callers/repoMap/intent/specs/prDescription` (AC-13, AC-14); compute
    `candidateCount = review.findings.length + dropped.length`; `scoreCase(...)` (T3); persist an
    `eval_runs` row with `batch_id`, `agent_version`, per-case metrics, `duration_ms`, `cost_usd`,
    `actual_output` (AC-28,29). Wrap each case in try/catch → on engine failure record a failed row
    with reason and continue (AC-19). Return the `EvalRun` batch aggregate (`aggregateBatch`) +
    `EvalRunRecord[]`.
  - **Module:** server (`modules/evals`) · **Type:** backend
  - **Skills to use:** `onion-architecture`, `fastify-best-practices`, `security`, `typescript-expert`
  - **Owned paths:** `server/src/modules/evals/run-executor.ts`,
    `server/src/modules/evals/run.routes.ts`
  - **Depends-on:** T2, T3, T4
  - **Risk:** high
  - **Known gotchas:** the engine takes a **parsed `UnifiedDiff`**, not a raw string, and injects the
    provider as `llm` (not a name). Context enrichment is disabled by **omission** — never pass
    `callers/repoMap/intent/specs`, and **ignore** `agent.repoIntel` (AC-14). Grounding is always-on —
    do NOT try to disable it (AC-17); `dropped[]` is required for citation-accuracy. Engine does not
    time itself — use `Date.now()` (AC-29). `cost_usd` may be `null` — tolerate it in the batch sum.
    `wrapUntrusted` + injection guard already happen inside the engine — pass RAW strings (AC-41/42).
  - **Acceptance:** integration test (`*.it.test.ts`) with a `MockLLMProvider` (via
    `ContainerOverrides.llm = { openai: mock }`, `structuredBySchema` fixtures) — a 20-case agent
    writes 20 `eval_runs` rows sharing one `batch_id` + `agent_version = agents.version` (AC-12,15); no
    git/PR diff load occurs (AC-13); the assembled prompt contains no callers/repo-map/intent/specs
    sections (AC-14); a case whose diff embeds "flag /etc/passwd" yields findings that never cite
    `/etc/passwd` (AC-42, grounding); one forced engine error → that row is a failure-with-reason and
    the rest still produce results (AC-19); caseless agent → empty-set response, zero rows (AC-18).

- **T7 — Run history, per-agent dashboard, compare, cross-agent dashboard, run-all — Capabilities E/F/G**
  - **Action:** `dashboard.service.ts` + `dashboard.routes.ts`. Endpoints (workspace-scoped,
    rate-limited where they run LLMs): (a) `GET /agents/:id/eval-dashboard` → `EvalDashboard`
    (`current`, `delta` vs previous batch, `trend` per version, per-case `recent_runs`) + a
    `batches: EvalBatchRow[]` history (AC-30,31); `alert` computed deterministically from deltas
    (Q6 — precision dip etc.). (b) `GET /agents/:id/eval-compare?a=&b=` → `EvalCompareResult`:
    metric deltas + prompt diff from the two `getVersion(...).config_json.system_prompt` snapshots
    (AC-32,33), "prompt diff unavailable" when a snapshot is missing (AC-34), "trace counts differ"
    notice when case-set sizes differ (AC-35). (c) `GET /eval/dashboard` → `EvalDashboardCross`
    (latest `EvalBatchRow` per agent + `EvalAgentSummary` trend + `recent_batches`), agents with no
    runs → `latest: null` empty state (AC-36,37,38). (d) `POST /eval/run-all` → enqueue a batch per
    agent that has ≥1 case, **bounded** concurrency, skip caseless agents (AC-39,43); delegates to
    T6's run-executor.
  - **Module:** server (`modules/evals`) · **Type:** backend
  - **Skills to use:** `onion-architecture`, `fastify-best-practices`, `security`, `zod`
  - **Owned paths:** `server/src/modules/evals/dashboard.service.ts`,
    `server/src/modules/evals/dashboard.routes.ts`
  - **Depends-on:** T1, T6
  - **Risk:** medium
  - **Known gotchas:** batches are grouped by `batch_id` (Q1) — do not bucket by timestamp (concurrent
    batches collide, Q3). Prompt diff reads `config_json.system_prompt` (snapshot), not the live agent.
    `run-all` must bound concurrency so one click cannot launch unbounded LLM cost (AC-43); reuse the
    per-route `config.rateLimit` mechanism.
  - **Acceptance:** integration tests (`*.it.test.ts`) — 5 batches → 5 `EvalBatchRow` history rows + a
    3-series trend (AC-31); compare v6↔v7 → metric deltas + added/removed prompt lines (AC-32,33);
    snapshot-less side → deltas + "prompt diff unavailable" (AC-34); 20-vs-18 case batches → "trace
    counts differ" notice (AC-35); cross-agent dashboard lists each agent once, never-run agent shows
    empty state (AC-36,38); `run-all` triggers a batch per eligible agent and skips caseless ones
    (AC-39); exceeding the rate limit → 429 (AC-43).

- **T8 — Case CRUD + single-case run (Run-on-save) — Capability B (server side)**
  - **Action:** `cases.service.ts` + `cases.routes.ts`. Endpoints: `GET /agents/:id/eval-cases`
    (list with latest-run status), `POST /agents/:id/eval-cases` (manual create), `GET/PUT/DELETE
    /eval-cases/:id`, `POST /eval-cases/:id/run` (single-case run via T6 executor → `EvalRunResult`).
    Validate `expected_output` against `z.array(ExpectedFinding)` and reject invalid saves (AC-10).
    Support the "Run on save" behaviour by running the single case immediately when requested (AC-11).
    All endpoints workspace-scoped via the case→agent ownership check (AC-40).
  - **Module:** server (`modules/evals`) · **Type:** backend
  - **Skills to use:** `onion-architecture`, `fastify-best-practices`, `zod`, `security`
  - **Owned paths:** `server/src/modules/evals/cases.service.ts`,
    `server/src/modules/evals/cases.routes.ts`
  - **Depends-on:** T6 (single-run reuses the executor)
  - **Risk:** medium
  - **Known gotchas:** reuse the T6 executor for one case — do not duplicate run logic. Validate
    `expected_output` with `safeParse` and return field errors (AC-10). A never-run case must not be
    invented a status (leave metrics null → client renders "never run", AC-8).
  - **Acceptance:** integration tests (`*.it.test.ts`) — CRUD round-trips a case; a malformed
    `expected_output` is rejected (AC-10); `POST /eval-cases/:id/run` returns `EvalRunResult` with
    pass/expected/got/duration/cost (AC-11); a cross-workspace case id → not-found (AC-40).

### Phase 5 — Client — Capabilities B/E/F/G

- **T9 — Evals API hooks**
  - **Action:** `client/src/lib/hooks/evals.ts` mirroring `hooks/agents.ts`: `useEvalCases(agentId)`,
    `useCreateEvalCase`, `useEvalCaseFromFinding(findingId)`, `useUpdateEvalCase`, `useDeleteEvalCase`,
    `useRunEvalCase`, `useRunAgentEvals(agentId)`, `useEvalDashboard(agentId)`, `useEvalCompare`,
    `useEvalDashboardCross`, `useRunAllAgents`. Types from `@devdigest/shared` (incl. new
    `eval-batch.ts`). Query keys as inline arrays; mutations invalidate the right keys. Export via the
    hooks barrel.
  - **Module:** client · **Type:** ui · **Skills to use:** `react-best-practices`,
    `frontend-architecture`, `typescript-expert`
  - **Owned paths:** `client/src/lib/hooks/evals.ts`, `client/src/lib/hooks/index.ts` (add exports)
  - **Depends-on:** T1
  - **Risk:** low
  - **Known gotchas:** all API access goes through `src/lib/api.ts` (`api.get/post/...`); never
    hand-duplicate contract types — import from `@devdigest/shared`. Match the existing per-domain hook
    shape (no central key factory).
  - **Acceptance:** `cd client && npx tsc --noEmit` passes; hooks import from `@devdigest/shared` and
    `../api`; exported from the barrel.

- **T10 — AgentEditor "Evals" tab (cases list + metrics + run history) — Capability B/E**
  - **Action:** Add `{ key:"evals", labelKey:"editor.tabs.evals", icon }` to the AgentEditor `TABS`
    (`constants.ts`); render `{tab === "evals" && <EvalsTab agentId={agent.id}/>}` in
    `AgentEditor.tsx`; add `"evals"` to `VALID_TABS` in `app/agents/[id]/page.tsx`. Build
    `EvalsTab/` (case rows with pass/fail/never-run status + "expected N, got M" summary +
    severity·category tag (AC-7); never-run distinct state, no metrics (AC-8); per-row run/edit/delete
    + header New + Run-all (AC-9); batch metrics recall/precision/citation/traces with deltas vs
    previous batch (AC-30); run-history list + metric-trend chart (AC-31)). Use the existing `eval`
    i18n namespace (`evalsTab.*`, `dashboard.*`).
  - **Module:** client · **Type:** ui · **Skills to use:** `frontend-architecture`,
    `react-best-practices`, `next-best-practices`, `react-testing-library`
  - **Owned paths:** `client/src/app/agents/[id]/_components/AgentEditor/EvalsTab/**`,
    `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx`,
    `client/src/app/agents/[id]/_components/AgentEditor/constants.ts`,
    `client/src/app/agents/[id]/page.tsx`
  - **Depends-on:** T9
  - **Risk:** medium
  - **Known gotchas:** `page.tsx` coerces unknown `?tab=` back to `config` (current `VALID_TABS =
    ["config","skills","context"]`) — you MUST add `"evals"` or the tab is unreachable.
    `editor.tabs.evals` already exists in `agents.json`. Links to case-editor/compare use router
    navigation (own separate routes), not direct imports, to keep owned paths non-overlapping with
    T11/T12.
  - **Acceptance:** `cd client && npx vitest run` for a new `EvalsTab.test.tsx` — 5 cases render 5 rows
    (AC-7); a never-run case shows the "never run" label and no metric numbers (AC-8); run/edit/delete +
    New + Run-all controls present and keyboard-operable (AC-9); metrics render with signed deltas
    (AC-30, a11y: sign not colour-only); typecheck passes.

- **T11 — Eval case editor (create/edit, expected-output validation, Run-on-save) — Capability B**
  - **Action:** Build the case editor surface (its own route under `app/eval/**` or `app/agents/[id]/
    eval-cases/**`, per `eval.json` `page.crumbNewCase`/`crumbEvalCase`): name, frozen diff + PR-meta
    tabs, expected-output JSON with a live "valid/invalid JSON" indicator that blocks Save on an
    invalid `ExpectedFinding[]` (AC-10), and a "Run on save" toggle that runs the single case and shows
    "Last run … · expected N · got M · <ms> · $<cost>" (AC-11). Reuse `eval.caseEditor.*` i18n keys.
  - **Module:** client · **Type:** ui · **Skills to use:** `frontend-architecture`,
    `react-best-practices`, `zod`, `react-testing-library`
  - **Owned paths:** `client/src/app/eval/cases/**` (or the chosen colocated route dir — must not
    overlap T10/T14 files)
  - **Depends-on:** T9
  - **Risk:** medium
  - **Known gotchas:** validate `expected_output` client-side with the shared `ExpectedFinding` schema
    (`safeParse`) so the indicator matches server rejection (AC-10). Derive the valid/invalid state
    during render — do not store it in `useState`+`useEffect`.
  - **Acceptance:** `EvalCaseEditor.test.tsx` — malformed expected-output → indicator invalid + Save
    disabled (AC-10); saving with Run-on-save on → shows the per-case result footer (AC-11).

- **T12 — Compare view (two batches) — Capability F**
  - **Action:** Build the compare surface: select exactly two batches → metric deltas (recall,
    precision, citation, cost) older→newer (AC-32); system-prompt diff (added/removed) from the
    compare response (AC-33); "prompt diff unavailable" note when a snapshot is missing (AC-34);
    "trace counts differ: X vs Y" notice (AC-35). Render the "Promote vN" control **enabled** (Q5,
    user decision): it calls `usePromoteAgentVersion` (T17) with the newer batch's `agent_version`,
    behind a confirm dialog ("Make v{N} the active version?"), invalidates the agent + eval-dashboard
    queries on success, and surfaces the resulting new active version. Promote targets the batch's
    `agent_version`; disable the control only when that version lacks a snapshot (nothing to promote).
  - **Module:** client · **Type:** ui · **Skills to use:** `frontend-architecture`,
    `react-best-practices`, `react-testing-library`
  - **Owned paths:** `client/src/app/eval/compare/**` (or colocated compare dir — non-overlapping)
  - **Depends-on:** T9, **T17** (promote endpoint + hook)
  - **Risk:** medium
  - **Known gotchas:** deltas must carry a sign/arrow (not colour-only) for a11y; selection checkboxes
    and the Promote button keyboard-operable with accessible names + an i18n confirm dialog (no inline
    English). Promotion is **not destructive** — it creates a new forward version equal to vN (see T17);
    do not imply it rewrites history in the copy. The hook lives in `hooks/agents.ts` (agents domain),
    not `hooks/evals.ts`.
  - **Acceptance:** `EvalCompare.test.tsx` — selecting two batches shows "recall 78% → 82% ▲4pt" style
    deltas (AC-32); prompt diff renders added/removed lines (AC-33); snapshot-less → unavailable note +
    Promote disabled for that side (AC-34); differing case counts → notice (AC-35); clicking "Promote
    v{N}" → confirm → calls the promote mutation with that version and shows the new active version.

- **T13 — Finding "Turn into eval case" action — Capability A (client)**
  - **Action:** Add a third action button to `FindingCard`'s action row (alongside accept/dismiss,
    the `s.actions` div) wired through `FindingsPanel` to `useEvalCaseFromFinding` (T9). On an
    undecided finding, surface the "decide first" prompt from the AC-4 server response rather than
    creating a case.
  - **Module:** client · **Type:** ui · **Skills to use:** `react-best-practices`,
    `frontend-architecture`, `react-testing-library`
  - **Owned paths:**
    `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx`,
    `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsPanel/FindingsPanel.tsx`
  - **Depends-on:** T9
  - **Risk:** low
  - **Known gotchas:** icon-only button needs an `aria-label` (i18n). Do not add eval strings inline —
    add keys to a message namespace (reuse `eval`/`prReview`). The untracked `ReviewFocusCard.tsx` is a
    separate card, not this action row — do not modify it.
  - **Acceptance:** `FindingCard.test.tsx` — the action appears; clicking a decided finding calls the
    create-from-finding mutation; an undecided finding surfaces the "decide first" prompt (AC-4) and
    creates no case.

- **T14 — Eval Dashboard page + sidebar entry — Capability G**
  - **Action:** Add `app/eval/page.tsx` (thin) rendering an `EvalDashboardView` (`"use client"`,
    mirror `app/skills/SkillsListView`) wrapped in `AppShell` with the `eval.page.*` crumbs; lists each
    agent once with latest recall/precision/citation, model badge, last-run version+timestamp+pass
    count, trend sparkline (AC-36); "recent eval runs · all agents" most-recent-first (AC-37); never-
    evaluated agents show "no runs yet" (AC-38); "Run all agents" action (AC-39). Add the SKILLS LAB
    nav entry `{ key:"eval", label:"Eval Dashboard", icon, href:"/eval", gKey }` in
    `vendor/ui/nav.ts` (+ optional shortcut).
  - **Module:** client · **Type:** ui · **Skills to use:** `frontend-architecture`,
    `next-best-practices`, `react-best-practices`, `react-testing-library`
  - **Owned paths:** `client/src/app/eval/page.tsx`,
    `client/src/app/eval/_components/EvalDashboardView/**`, `client/src/vendor/ui/nav.ts`
  - **Depends-on:** T9
  - **Risk:** medium
  - **Known gotchas:** `activeKeyFor` already returns `"eval"` for `/eval*` — the nav item key MUST be
    `"eval"` for active-state to resolve. `nav.ts` is under `vendor/ui` and uses plain-string labels +
    a `:repoId` href token (the dashboard href `/eval` has no repo token). Keep the route `/eval` to
    match. If `page.tsx` conflicts with T11/T12 route choices, colocate those under
    `app/eval/cases` and `app/eval/compare` (already assigned) so page files don't overlap.
  - **Acceptance:** `EvalDashboardView.test.tsx` — dashboard lists each agent once with latest metrics
    (AC-36); most-recent batch tops the recent-runs list (AC-37); a zero-batch agent shows the empty
    state (AC-38); "Run all agents" triggers the bounded run-all (AC-39); navigating to `/eval` shows
    the sidebar entry active.

### Phase 6 — Security / rate-limit / i18n / a11y hardening

- **T15 — Cross-cutting hardening + verification pass**
  - **Action:** Add focused tests + fill any i18n gaps: (server) assert every eval endpoint is
    workspace-scoped and returns not-found across workspaces (AC-40); assert frozen inputs are wrapped
    untrusted in the assembled prompt and the injection case never cites an out-of-diff file (AC-41,42);
    assert batch/run-all are rate-limited and run-all is bounded (AC-43). (client) assert pass/fail and
    deltas carry a text/icon label + sign (not colour alone) and selection/actions are keyboard-operable
    with accessible names (NFR a11y); assert no hard-coded user-facing English — all strings resolve via
    `eval`/`agents` namespaces (NFR i18n). Add any missing keys to `client/messages/en/eval.json`.
  - **Module:** server + client · **Type:** backend + ui (tests + i18n only)
  - **Skills to use:** `security`, `react-testing-library`, `react-best-practices`
  - **Owned paths:** `server/test/evals-*.it.test.ts` (new test files only),
    `client/src/**/*.eval-a11y.test.tsx` (new test files only),
    `client/messages/en/eval.json` (additive keys only)
  - **Depends-on:** T7, T8, T10, T11, T12, T13, T14
  - **Risk:** low
  - **Known gotchas:** owns only NEW test files + additive i18n keys to avoid overlap with feature
    tasks. DB-backed server tests must use the `*.it.test.ts` (Docker-gated) convention. The grounding
    gate is the structural defence for AC-42 — assert behaviour, do not weaken it.
  - **Acceptance:** `cd server && pnpm test` (evals `*.it.test.ts`) and `cd client && npx vitest run`
    green; the AC-40/41/42/43 + a11y + i18n assertions pass.

### Phase 7 — The sensitivity experiment (headline) — Capability I

- **T16 — Seed "Security Reviewer" + AC-44 end-to-end proof**
  - **Action:** Seed (a dedicated `server/src/db/seed-evals.ts` or an additive block in
    `server/src/db/seed.ts`) a "Security Reviewer" agent with a gold set: an accepted `stripe-key-leak`
    case (`must_find` on `src/config.ts:12`) and a dismissed `clean-refactor` case (`must_not_flag`).
    Add an integration test (`*.it.test.ts`) that: runs evals on the current prompt (batch 1); edits the
    system prompt to a stronger version (new agent version) and re-runs (batch 2) — asserts run history
    shows the metric move and compare shows the prompt diff; corrupts the prompt (e.g. "flag unused
    imports") and re-runs (batch 3) — asserts **precision drops** vs the prior batch because the extra
    findings are counted as noise. Uses a deterministic `MockLLMProvider` fixture per prompt version so
    the drop is reproducible without real LLM cost.
  - **Module:** server (seed + integration) · **Type:** backend
  - **Skills to use:** `drizzle-orm-patterns`, `react-testing-library` (vitest), `security`
  - **Owned paths:** `server/src/db/seed-evals.ts` (new) or additive block in `server/src/db/seed.ts`,
    `server/test/evals-sensitivity.it.test.ts` (new)
  - **Depends-on:** T15
  - **Risk:** medium
  - **Known gotchas:** three prompt versions need three distinct mock fixtures; the corrupted version's
    fixture must emit an extra unmatched (noise) finding so precision provably falls (AC-25/22
    interaction). Determinism: no real LLM call (N3). Docker-gated `*.it.test.ts`.
  - **Acceptance:** `evals-sensitivity.it.test.ts` green — three batches produce three `EvalBatchRow`
    history rows; batch 3 precision < batch 2 precision; compare renders metric deltas + prompt diff
    (AC-44).

## Capability → phase/AC coverage map (no AC dropped)

| Capability | ACs | Tasks |
|---|---|---|
| A — Create case from finding | AC-1..6 | T5 (server), T13 (client) |
| B — List/manage cases (Evals tab) | AC-7..11 | T8 (server), T10 + T11 (client) |
| C — Batch run | AC-12..19 | T6 |
| D — Scoring | AC-20..27 | T3 |
| E — Run history & per-agent metrics | AC-28..31 | T6 (persist), T7 (aggregate), T10 (display) |
| F — Compare two runs | AC-32..35 | T7 (server), T12 (client) |
| F — Promote vN (Q5, spec N5 → agents module) | compare "Promote vN" control | T17 (agents endpoint + hook), T12 (client wiring) |
| G — Eval Dashboard (cross-agent) | AC-36..39 | T7 (server), T14 (client) |
| H — Access control / untrusted / cost | AC-40..43 | T5/T6/T7/T8 (built-in), T15 (verify) |
| I — Sensitivity experiment | AC-44 | T16 |

## Testing strategy
- **reviewer-core (unit):** `cd reviewer-core && npx vitest run src/eval/score.test.ts` — the scorer
  (AC-20..27), pure, no LLM.
- **server (vitest):** run with `cd server && pnpm test` (vitest picks up both `server/test/**/*.test.ts`
  and co-located `src/**/*.test.ts`). **DB-backed integration tests use the `*.it.test.ts` convention**
  (Testcontainers-Postgres, Docker-gated via `hasDocker ? describe : describe.skip`) and live in
  `server/test/`; they build the real app via `buildApp` + `startPg` + `seed` and drive it through
  `ContainerOverrides`. Inject a deterministic `MockLLMProvider` (`src/adapters/mocks.ts`) as
  `llm: { openai: mock }`, using its `structuredBySchema` fixtures to return per-schema review outputs;
  `parseUnifiedDiff` turns frozen `input_diff` into `UnifiedDiff`. Coverage: capture (AC-1..6, 40),
  run-executor (AC-12..19, 28, 29, 41, 42), dashboard/compare (AC-30..39), cases CRUD (AC-7..11),
  rate-limit/run-all bound (AC-43), sensitivity (AC-44). Migration-journal workaround
  (`drizzle-kit push --force` + `CREATE EXTENSION vector`) per `server/INSIGHTS.md`.
- **client (integration, vitest + jsdom + RTL, MSW at the network layer):** `cd client && npx vitest
  run` — EvalsTab, case editor, compare, finding action, dashboard, a11y/i18n (AC-7..11, 30..39; NFR).
- **Static:** `cd server && npm run typecheck`, `cd client && npx tsc --noEmit`. Note: **no
  `depcruise` script or `.dependency-cruiser` config is committed** — onion layering is enforced by
  convention/review here (the `onion-architecture` skill still governs placement; do not add adapter
  imports to routes/service or `db/schema` imports outside `repository.ts`).

## Risks & mitigations
- **Editing `vendor/shared` (do-not-touch).** → Only a NEW file + one barrel export line (sanctioned);
  no existing eval contract edited. Mirror to client vendor identically. Coordinate the barrel edit.
- **Contract drift between server + client vendor mirrors.** → T1 adds byte-identical files; T15
  asserts both typecheck. Accepted maintenance gotcha per the spec.
- **Migration journal out of sync.** → Use `db:generate` (never hand-edit); order is by
  `meta/_journal.json` not filename; rely on the documented `drizzle-kit push --force` +
  `CREATE EXTENSION vector` test workaround.
- **Overlapping owned paths in the single server module.** → Split into per-capability sub-service +
  sub-route files; `repository.ts` is completed once in T4 and only read afterwards; the module
  `routes.ts` index (T4) references sub-plugins created by T5-T8 (no shared edits).
- **Accidentally leaving context enrichment on / disabling grounding.** → T6 omits enrichment fields
  and ignores `agent.repoIntel`; grounding is untouched; T15 asserts both (AC-14, AC-17, AC-42).
- **Unbounded LLM cost from run-all.** → Bounded concurrency + rate-limit (AC-43); Q3 accepts
  independent concurrent batches (no single-flight) as spec states.
- **Q5 promotion (now in scope, user-approved).** → Implemented in the **agents** module (T17), not
  evals, honouring spec N5's boundary. Non-destructive (forward version equal to vN). Sole hazard: the
  `agent_skills` re-apply after `update()` — pinned as an explicit sub-step + acceptance assertion.

## Red-flags check
- [x] Every requirement maps to a task (capability→task table above; every AC-1..44 assigned)
- [x] No specification was authored or edited — the spec is input; this plan restates + verifies it
- [x] Execution mode is recorded (multi-agent, parallel) and the plan is shaped for it
- [x] Dependencies form a DAG (see mermaid; no cycles)
- [x] (multi-agent) Concurrent tasks have non-overlapping Owned paths (T17∥all-evals; T5∥T6; T7∥T8;
      T10∥T11∥T12∥T13∥T14 — T12 additionally depends on T17's agents-module endpoint)
- [x] Every Acceptance is measurable (named tests / commands / observable behaviour tied to AC-numbers)
- [x] No edits to existing shared contracts — new `eval-batch.ts` file only (barrel export line flagged)

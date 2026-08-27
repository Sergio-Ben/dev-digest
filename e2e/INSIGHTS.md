# Insights — e2e

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-08-08** — Seeded ROW IDS are not stable across seeds: `server/src/db/seed.ts` inserts findings/reviews without an explicit `id`, so Postgres generates a fresh uuid on every re-seed — and the hermetic runner re-seeds from empty each run. A flow asserting a deep link must therefore match the PARAM (`wait --url "finding="`) plus a stable seeded string (the finding's title/rationale), never a literal uuid. Stable anchors in the seed are the PR number (`#482`), repo `acme/payments-api`, file paths, and finding titles. Evidence: `e2e/specs/08-smart-diff-finding-nav.flow.json`, `server/src/db/seed.ts:258-283`.
- **2026-08-18** — `agent-browser wait --text "<s>"` matches against `document.body.innerText`, which — unlike `textContent` — applies CSS `text-transform`. A component styled with `textTransform: "uppercase"` (e.g. `SectionLabel`/any card header using that style, like `PrBriefCard`'s "PR Brief" label) renders as all-caps in `innerText` even though the JSX/i18n string is mixed-case. A `wait --text "PR Brief"` step fails against that DOM even though the text is visibly present — the flow must assert the CSS-transformed casing (`wait --text "PR BRIEF"`) instead. Confirmed directly: `agent-browser eval "document.body.innerText.includes('PR Brief')"` → `false`, `...includes('PR BRIEF')` → `true`, on the live page. Evidence: `e2e/specs/09-pr-brief.flow.json`, `client/.../OverviewTab/PrBriefCard/PrBriefCard.tsx` (`SectionLabel` usage).
- **2026-08-18** — The `_journal.json` migration-drift bug (`server/INSIGHTS.md` 2026-08-18, missing/duplicate journal entries for `0009`–`0013`) also breaks `./scripts/e2e.sh`, not just `*.it.test.ts` — its `pnpm db:migrate` step fails on the same `column "cost_usd" of relation "agent_runs" does not exist` before seeding ever runs. To verify a seed/e2e change end-to-end without that migration set fixed, replicate the script manually but swap `pnpm db:migrate` for `drizzle-kit push --force` (plus a one-off `CREATE EXTENSION IF NOT EXISTS vector`, since a fresh pgvector container doesn't have it yet and `push` only diffs `db/schema.ts`, not migration 0000's `CREATE EXTENSION` statement) — then `pnpm db:seed`, start the API (`tsx src/server.ts`) and web (`next dev -p <port>`) with matching `DATABASE_URL`/`API_PORT`/`WEB_PORT`/`NEXT_PUBLIC_API_BASE`/`E2E_BASE_URL`, and run `cd e2e && npm test`. Confirmed this reproduces the real hermetic flow (all 9 specs, including a new one, passed this way). Evidence: `scripts/e2e.sh`, `server/test/helpers/pg.ts`.

## Tool & Library Notes

## Recurring Errors & Fixes

- **2026-08-27** — A `find role button click` on a BELOW-THE-FOLD target is flaky in CI even though it passes locally: the single command scrolls-and-clicks atomically, and under CI's slower `next start` (production) layout the click can land before the scroll/layout settles, so the click is dispatched at stale coords, `onClick` never fires, and the step still reports success — the failure surfaces one step LATER (e.g. `wait --url tab=diff` times out at 60s while the click "passed"). Reproduced: `09-pr-brief.flow.json`'s review-focus row renders at ~y1200 in an ~577px viewport (the tall PR Brief + Intent/Blast cards push it down), `belowFold:true` at `scrollY:0`. Fix: add a dedicated `{ "cmd": ["scrollintoview", "button[aria-label=\"…\"]"] }` step BEFORE the `find … click`, so the element is already in-view and settled when the click runs (verified 10/10 vs the raw atomic click). Contrast: `08-smart-diff-finding-nav.flow.json` does the same kind of deep-link but clicks the top-of-page "Files changed" TAB button (always in-view) and never needed this. Evidence: `e2e/specs/09-pr-brief.flow.json`, `client/.../OverviewTab/OverviewTab.tsx` (ReviewFocusCard sits below the Intent/Blast grid).
- **2026-08-27** — `agent-browser find text "<s>" click` / `find role … click` do NOT poll or auto-wait — they query the DOM once and fail immediately if the element isn't there yet. Steps like `09`'s step-3 `open / → wait --url /pulls → find text "Add rate limiting…" click` rely on the PR-list fetch having rendered by the time `find` runs; on a FAST dev machine `find` outruns the client render and fails, while slower CI happens to win the race. When driving flows by hand to debug, insert a `wait --text "<the row text>"` before any bare `find … click` or you'll chase a phantom "element not found" that CI never sees. (The committed flows omit that wait and pass in CI, so don't "fix" it there without cause.) Evidence: `e2e/run.ts` (one `execFile` per step, no retry), `agent-browser 0.34.0 find --help`.

## Session Notes

## Open Questions

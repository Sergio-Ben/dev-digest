# Insights — e2e

Non-obvious findings and gotchas. Add an entry whenever something surprised you,
so the next agent/session doesn't relearn it. Append-only — see the
`engineering-insights` skill for how entries are captured.

## What Works

## What Doesn't Work

## Codebase Patterns

- **2026-08-08** — Seeded ROW IDS are not stable across seeds: `server/src/db/seed.ts` inserts findings/reviews without an explicit `id`, so Postgres generates a fresh uuid on every re-seed — and the hermetic runner re-seeds from empty each run. A flow asserting a deep link must therefore match the PARAM (`wait --url "finding="`) plus a stable seeded string (the finding's title/rationale), never a literal uuid. Stable anchors in the seed are the PR number (`#482`), repo `acme/payments-api`, file paths, and finding titles. Evidence: `e2e/specs/08-smart-diff-finding-nav.flow.json`, `server/src/db/seed.ts:258-283`.

## Tool & Library Notes

## Recurring Errors & Fixes

## Session Notes

## Open Questions

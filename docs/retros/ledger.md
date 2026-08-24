# Workflow Retro Ledger

One row per `/workflow-retro` run, so multi-agent runs can be compared over time.
Cost uses per-model rates verified via the `claude-api` skill at retro time (rates drift).

| date | label | agents | in→out tok | cache hit | wall | parallelism | cost | top recommendation |
|------|-------|--------|-----------|-----------|------|-------------|------|--------------------|
| 2026-06-30 | spec-project-context | 5 (1+4 nested) | 33k→79k (8.1M cache-read) | 85% | 22.9m | 1.4× | $11.89 | Give spec-creator `Edit` so it revises in place instead of rewriting the whole spec each turn (already fixed) |
| 2026-06-30 | run-plan-project-context | 21 (all depth-1) | 20k→197k (86.5M cache-read) | 95% | ~46m | ~1.4× | ≈$50 (est) | Decide e2e inclusion *before* dispatch — T17 ran ~484s / 20k out / 82 tools, then was fully reverted |

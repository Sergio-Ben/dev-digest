import { z } from 'zod';
import { Severity } from './findings.js';
import { EvalTrendPoint } from './eval-ci.js';

/**
 * Eval batch / compare / cross-agent-dashboard contracts (agent eval pipeline).
 *
 * A "batch" is one execution of an agent (a specific `agent_version`) across ALL
 * of its eval cases through the real `reviewer-core` engine — one row per batch,
 * aggregated via `reviewer-core`'s `aggregateBatch()`. These contracts sit ABOVE
 * the per-case shapes in `eval-ci.ts` (`EvalCaseInput`, `EvalRunRecord`,
 * `EvalTrendPoint`); `EvalTrendPoint` is reused as-is, not redefined.
 */

// ===========================================================================
// ExpectedFinding — the AC-10 finding-skeleton frozen onto an eval case
// ===========================================================================

/** A minimal finding skeleton: enough to score recall/precision/citation-accuracy
 *  against an agent's actual output, without carrying the full `Finding` shape. */
export const ExpectedFinding = z.object({
  severity: Severity,
  category: z.string(),
  title: z.string(),
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int().nullish(),
});
export type ExpectedFinding = z.infer<typeof ExpectedFinding>;

// ===========================================================================
// EvalBatchRow — one row per agent-version execution across all its cases
// ===========================================================================

export const EvalBatchRow = z.object({
  batch_id: z.string(),
  agent_id: z.string(),
  agent_version: z.number().int(),
  ran_at: z.string(),
  recall: z.number(),
  precision: z.number(),
  citation_accuracy: z.number(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  cost_usd: z.number().nullable(),
});
export type EvalBatchRow = z.infer<typeof EvalBatchRow>;

// ===========================================================================
// EvalCompareResult — diff between two batches (older vs newer)
// ===========================================================================

export const EvalCompareResult = z.object({
  older: EvalBatchRow,
  newer: EvalBatchRow,
  deltas: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  prompt_diff: z
    .object({
      added: z.array(z.string()),
      removed: z.array(z.string()),
    })
    .nullable(),
  trace_count_notice: z.string().nullable(),
});
export type EvalCompareResult = z.infer<typeof EvalCompareResult>;

// ===========================================================================
// EvalAgentSummary / EvalDashboardCross — cross-agent Eval Dashboard
// ===========================================================================

export const EvalAgentSummary = z.object({
  agent_id: z.string(),
  name: z.string(),
  model: z.string(),
  latest: EvalBatchRow.nullable(),
  trend: z.array(EvalTrendPoint),
});
export type EvalAgentSummary = z.infer<typeof EvalAgentSummary>;

export const EvalDashboardCross = z.object({
  agents: z.array(EvalAgentSummary),
  recent_batches: z.array(EvalBatchRow),
});
export type EvalDashboardCross = z.infer<typeof EvalDashboardCross>;

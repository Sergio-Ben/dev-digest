import type { EvalBatchRow, EvalCase, EvalRunRecord } from '@devdigest/shared';
import { aggregateBatch, type AggregatedBatch, type BatchCaseInput, type CaseScore } from '@devdigest/reviewer-core';
import type { EvalBatchAggregateRow, EvalCaseRow, EvalRunRow } from './repository.js';

/**
 * Pure row → DTO mappers for the evals module. No I/O — inputs are already
 * fetched rows from `EvalsRepository`; outputs are the public `@devdigest/
 * shared` contracts consumed by routes/clients. Also owns the pure MICRO-
 * average batch-aggregation helpers (`groupRunsIntoBatches` + friends) —
 * `reviewer-core`'s `aggregateBatch` is Core, safe to import from any layer,
 * and this file already has no I/O of its own.
 */

/** Map a persisted `eval_cases` row to the public `EvalCase` DTO. */
export function toEvalCaseDto(row: EvalCaseRow): EvalCase {
  return {
    id: row.id,
    owner_kind: row.ownerKind,
    owner_id: row.ownerId,
    name: row.name,
    input_diff: row.inputDiff ?? '',
    input_files: row.inputFiles ?? null,
    input_meta: row.inputMeta ?? null,
    expected_output: row.expectedOutput ?? null,
    notes: row.notes ?? null,
  };
}

/**
 * Map a persisted `eval_runs` row to the public `EvalRunRecord` DTO.
 * `caseName` is optional — pass it when the caller already joined/knows the
 * owning case's name (avoids an extra per-row lookup); omitted it maps to
 * `null`.
 */
export function toEvalRunRecordDto(row: EvalRunRow, caseName?: string | null): EvalRunRecord {
  return {
    id: row.id,
    case_id: row.caseId,
    case_name: caseName ?? null,
    ran_at: row.ranAt.toISOString(),
    actual_output: findingsFromActualOutput(row.actualOutput),
    pass: row.pass,
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

/**
 * Unwrap the EXTERNAL `actual_output` the DTO exposes from whatever shape is
 * actually persisted in `eval_runs.actual_output`. `run-executor.ts` stores
 * `{ findings, counts }` on a successful run (the `counts` sub-object is an
 * internal-only addition so batch read-backs can MICRO-average — see
 * `groupRunsIntoBatches`/`countsFromRow` below) and `{ error, counts }` on a
 * failed run (AC-19). Neither shape is what a client should see: AC-28
 * defines `actual_output` as "the produced findings", and the client's
 * `EvalsTab#actualCount()` / test fixtures assume a bare findings array —
 * so this is the one place that unwraps `{ findings, counts }` back down to
 * `findings` for the public DTO, while `countsFromRow`/`caseScoreFromRow`
 * below keep reading `row.actualOutput.counts` straight off the RAW row
 * (never through this DTO), so the batch micro-average is unaffected.
 */
function findingsFromActualOutput(actualOutput: unknown): unknown {
  if (actualOutput == null) return null;
  if (Array.isArray(actualOutput)) return actualOutput;
  if (typeof actualOutput === 'object' && 'findings' in actualOutput) {
    return (actualOutput as { findings: unknown }).findings;
  }
  // Failure row shape `{ error, counts }` (no findings) — AC-28 only defines
  // the success case; expose an empty array rather than leaking the error
  // wrapper (a failed run has zero produced findings by definition).
  return [];
}

/** Map a repository batch aggregate to the public `EvalBatchRow` DTO. */
export function toEvalBatchRowDto(row: EvalBatchAggregateRow): EvalBatchRow {
  return {
    batch_id: row.batchId,
    agent_id: row.agentId,
    agent_version: row.agentVersion ?? 0,
    ran_at: row.ranAt.toISOString(),
    recall: row.recall,
    precision: row.precision,
    citation_accuracy: row.citationAccuracy,
    traces_passed: row.tracesPassed,
    traces_total: row.tracesTotal,
    cost_usd: row.costUsd,
  };
}

// =============================================================================
// Micro-average batch aggregation (fix for the SQL avg()/MACRO-average bug —
// see server/INSIGHTS.md "T16 macro-vs-micro" entry). `eval_runs.recall`/
// `.precision`/`.citation_accuracy` are correct per-case RATIOS, but the
// counts backing them are otherwise lost once persisted — AC-21/22/23 define
// a batch metric as counts summed across ALL cases, THEN divided (micro), not
// an average of per-case ratios (macro). `run-executor.ts` persists the raw
// counts inside `actual_output.counts` (see `toEvalRunCounts`) precisely so
// they survive a read-back and `groupRunsIntoBatches` can reconstruct them.
// =============================================================================

/** Raw per-case counts persisted inside `eval_runs.actual_output` — the only
 *  way to reconstruct a MICRO-average from persisted rows without a schema
 *  migration (none allowed here — the migration journal is corrupted repo-
 *  wide, see server/INSIGHTS.md "Recurring Errors & Fixes"). Mirrors the
 *  count fields on reviewer-core's `CaseScore`. */
export interface EvalRunCounts {
  expected: number;
  matchedExpected: number;
  produced: number;
  matchedProduced: number;
  survived: number;
  candidate: number;
}

/** Extract the six raw counts `aggregateBatch` needs out of a `CaseScore` —
 *  called by `run-executor.ts` right before `insertRun`, for BOTH a scored
 *  success row and a failed row's `failedCaseScore` fallback. */
export function toEvalRunCounts(score: CaseScore): EvalRunCounts {
  return {
    expected: score.expectedCount,
    matchedExpected: score.matchedExpectedCount,
    produced: score.producedCount,
    matchedProduced: score.matchedProducedCount,
    survived: score.survivedCount,
    candidate: score.candidateCount,
  };
}

const ZERO_COUNTS: EvalRunCounts = {
  expected: 0,
  matchedExpected: 0,
  produced: 0,
  matchedProduced: 0,
  survived: 0,
  candidate: 0,
};

/** Read `EvalRunCounts` back out of a persisted row's `actual_output`. A row
 *  written before this fix (or any shape without a `counts` sub-object)
 *  degrades to all-zero counts: it still counts toward `traces_total`/
 *  `traces_passed`/cost via its own `pass`/`cost_usd` columns, it just can't
 *  contribute to the recall/precision/citation numerators or denominators. */
function countsFromRow(row: EvalRunRow): EvalRunCounts {
  const output = row.actualOutput as { counts?: EvalRunCounts } | null;
  return (output && typeof output === 'object' && output.counts) || ZERO_COUNTS;
}

/** Reconstruct a `CaseScore` from a persisted `eval_runs` row: `recall`/
 *  `precision`/`citation_accuracy`/`pass` come straight from their own
 *  columns (already correct per-case ratios); the raw counts come from
 *  `actual_output.counts` (see `countsFromRow`). Feeds `aggregateBatch` on
 *  read-back — `aggregateBatch` itself never reads the ratio fields, only the
 *  counts + `pass`, so this is safe even for legacy rows without counts. */
export function caseScoreFromRow(row: EvalRunRow): CaseScore {
  const counts = countsFromRow(row);
  return {
    recall: row.recall ?? 0,
    precision: row.precision ?? 0,
    citation_accuracy: row.citationAccuracy ?? 0,
    pass: row.pass ?? false,
    expectedCount: counts.expected,
    matchedExpectedCount: counts.matchedExpected,
    producedCount: counts.produced,
    matchedProducedCount: counts.matchedProduced,
    survivedCount: counts.survived,
    candidateCount: counts.candidate,
  };
}

/** Group a flat list of `eval_runs` rows (already joined/scoped by the
 *  caller) into one `EvalBatchAggregateRow` per distinct `batch_id`, MICRO-
 *  averaging each batch via reviewer-core's `aggregateBatch` — the exact same
 *  formula that backs the synchronous `POST /agents/:id/eval-runs` response,
 *  so a batch's read-back metrics now agree with what just ran. Rows with a
 *  null `batch_id` are skipped (pre-batching/ad-hoc single-case runs — same
 *  filter the old SQL `isNotNull` applied). Returned newest-batch-first. */
export function groupRunsIntoBatches(
  rows: Array<EvalRunRow & { agentId: string }>,
): EvalBatchAggregateRow[] {
  const byBatch = new Map<string, Array<EvalRunRow & { agentId: string }>>();
  for (const row of rows) {
    if (!row.batchId) continue;
    const list = byBatch.get(row.batchId);
    if (list) list.push(row);
    else byBatch.set(row.batchId, [row]);
  }

  const batches: EvalBatchAggregateRow[] = [];
  for (const [batchId, batchRows] of byBatch) {
    const perCase: BatchCaseInput[] = batchRows.map((r) => ({
      score: caseScoreFromRow(r),
      costUsd: r.costUsd,
    }));
    const aggregate: AggregatedBatch = aggregateBatch(perCase);
    const agentVersions = batchRows
      .map((r) => r.agentVersion)
      .filter((v): v is number => v !== null);

    batches.push({
      batchId,
      agentId: batchRows[0]!.agentId,
      agentVersion: agentVersions.length > 0 ? Math.max(...agentVersions) : null,
      // `ranAt` comes straight off each row's own `ran_at` column (a direct
      // select, not a SQL `max()` expression) — postgres.js parses it as a
      // real `Date` on the way in, so no further coercion is needed here.
      ranAt: new Date(Math.max(...batchRows.map((r) => r.ranAt.getTime()))),
      recall: aggregate.recall,
      precision: aggregate.precision,
      citationAccuracy: aggregate.citation_accuracy,
      tracesPassed: aggregate.traces_passed,
      tracesTotal: aggregate.traces_total,
      costUsd: aggregate.cost_usd,
    });
  }

  return batches.sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime());
}

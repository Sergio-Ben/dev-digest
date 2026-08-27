/**
 * Pure deterministic eval scorer — recall / precision / citation-accuracy / pass.
 *
 * NO I/O, NO LLM call, NO side effects: same inputs always yield the same
 * metrics (spec AC-27). Mirrors the purity contract of `../grounding.ts` —
 * the scorer trusts the caller for the grounding result (it does not
 * re-ground), the same way `grounding.ts` trusts the caller for the diff.
 *
 * See `specs/2026-08-26-agent-eval-pipeline.md` Capability D (AC-20..27) and
 * `docs/plans/2026-08-26-agent-eval-pipeline.md` task T3 for the full contract.
 */

import type { Finding } from '@devdigest/shared';

/**
 * Local mirror of the `ExpectedFinding` contract that T1 is adding to
 * `server/src/vendor/shared/contracts/eval-batch.ts` (and its client mirror)
 * in parallel with this task. reviewer-core cannot yet rely on that export
 * landing in the shared barrel, so this shape is declared locally.
 *
 * Keep this identical to the shared `ExpectedFinding` zod shape; once T1's
 * export is available, swap this for
 * `import type { ExpectedFinding } from '@devdigest/shared'` and delete this
 * interface.
 */
export interface ExpectedFinding {
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line?: number | null;
}

/**
 * Per-case score. The four fields named in the plan (`recall`, `precision`,
 * `citation_accuracy`, `pass`) are the public contract; the remaining raw
 * counts are carried alongside so `aggregateBatch` can micro-average a whole
 * run (AC-21/22/23 are defined over counts summed across ALL cases, not an
 * average of per-case ratios).
 */
export interface CaseScore {
  recall: number;
  precision: number;
  citation_accuracy: number;
  pass: boolean;
  /** Raw counts backing the ratios above — consumed by `aggregateBatch`. */
  expectedCount: number;
  matchedExpectedCount: number;
  producedCount: number;
  matchedProducedCount: number;
  /** Findings that survived grounding for this case — equal to `produced.length`. */
  survivedCount: number;
  /** Pre-grounding candidate count (kept + dropped), supplied by the caller. */
  candidateCount: number;
}

/**
 * AC-20 — a produced finding matches an expected finding when their `file`
 * paths are string-equal AND their line ranges overlap. An expected finding
 * with only `start_line` is the degenerate range `[start_line, start_line]`.
 * Severity/category/title are NOT part of the match test.
 */
export function matches(expected: ExpectedFinding, produced: Finding): boolean {
  if (expected.file !== produced.file) return false;

  const expectedEnd = expected.end_line ?? expected.start_line;
  const overlapStart = Math.max(expected.start_line, produced.start_line);
  const overlapEnd = Math.min(expectedEnd, produced.end_line);

  return overlapStart <= overlapEnd;
}

/**
 * Score a single eval case.
 *
 * - AC-21/22 recall/precision are fractions over this case's findings.
 * - AC-23 citation_accuracy = (findings that survived grounding, i.e.
 *   `produced`) ÷ `candidateCount` (kept + dropped, supplied by the caller —
 *   this function does not re-ground).
 * - AC-24 vacuous denominators resolve to `1.0`.
 * - AC-25 strict pass: per-case recall = 1 AND precision = 1. A
 *   `must_not_flag` case (empty `expected`) passes iff `produced` is empty —
 *   which the formula above already guarantees (an empty-expected case with
 *   any produced findings has precision 0, since none can match).
 */
export function scoreCase(
  expected: ExpectedFinding[],
  produced: Finding[],
  candidateCount: number,
): CaseScore {
  const matchedExpectedCount = expected.filter((e) => produced.some((p) => matches(e, p))).length;
  const matchedProducedCount = produced.filter((p) => expected.some((e) => matches(e, p))).length;

  const recall = expected.length === 0 ? 1 : matchedExpectedCount / expected.length;
  const precision = produced.length === 0 ? 1 : matchedProducedCount / produced.length;
  const citation_accuracy = candidateCount === 0 ? 1 : produced.length / candidateCount;

  const pass = recall === 1 && precision === 1;

  return {
    recall,
    precision,
    citation_accuracy,
    pass,
    expectedCount: expected.length,
    matchedExpectedCount,
    producedCount: produced.length,
    matchedProducedCount,
    survivedCount: produced.length,
    candidateCount,
  };
}

/** One case's contribution to a batch aggregate: its score plus its cost. */
export interface BatchCaseInput {
  score: CaseScore;
  /** Per-case cost from the engine outcome; `null`/`undefined` when the provider didn't report one (AC-29). */
  costUsd?: number | null;
}

export interface AggregatedBatch {
  recall: number;
  precision: number;
  citation_accuracy: number;
  traces_passed: number;
  traces_total: number;
  cost_usd: number | null;
}

/**
 * Micro-average a batch of per-case scores (AC-21/22/23: counts summed
 * across ALL cases, then divided — not an average of per-case ratios).
 *
 * - AC-26 traces_passed / traces_total from each case's `pass`.
 * - AC-29 cost_usd = sum of known per-case costs; tolerates `null`/`undefined`
 *   costs (they simply don't contribute). If no case reported a cost,
 *   `cost_usd` is `null`.
 * - AC-27 every ratio metric stays within [0, 1] given valid inputs.
 */
export function aggregateBatch(perCase: BatchCaseInput[]): AggregatedBatch {
  let expectedTotal = 0;
  let matchedExpectedTotal = 0;
  let producedTotal = 0;
  let matchedProducedTotal = 0;
  let survivedTotal = 0;
  let candidateTotal = 0;
  let tracesPassed = 0;
  let costSum = 0;
  let hasKnownCost = false;

  for (const { score, costUsd } of perCase) {
    expectedTotal += score.expectedCount;
    matchedExpectedTotal += score.matchedExpectedCount;
    producedTotal += score.producedCount;
    matchedProducedTotal += score.matchedProducedCount;
    survivedTotal += score.survivedCount;
    candidateTotal += score.candidateCount;
    if (score.pass) tracesPassed += 1;

    if (costUsd !== null && costUsd !== undefined) {
      costSum += costUsd;
      hasKnownCost = true;
    }
  }

  return {
    recall: expectedTotal === 0 ? 1 : matchedExpectedTotal / expectedTotal,
    precision: producedTotal === 0 ? 1 : matchedProducedTotal / producedTotal,
    citation_accuracy: candidateTotal === 0 ? 1 : survivedTotal / candidateTotal,
    traces_passed: tracesPassed,
    traces_total: perCase.length,
    cost_usd: hasKnownCost ? costSum : null,
  };
}

/* Pure helpers for the Evals tab (T10). No React, no I/O — safe to unit test
   in isolation and reused by CaseRow / MetricsPanel / RunHistoryTable.

   Why case status is derived here rather than trusted from `useEvalCases`:
   `EvalCase` (the type `useEvalCases` actually returns, per T9) carries no
   run/status fields — only `EvalDashboard.recent_runs` (`EvalRunRecord[]`,
   keyed by `case_id`) does. So "pass/fail/never-run" per case (AC-7/8) is
   derived by joining the two queries here, not read off the case itself. */
import { z } from "zod";
import { ExpectedFinding } from "@devdigest/shared";
import type { EvalCase, EvalRunRecord, EvalBatchRow } from "@devdigest/shared";

const ExpectedFindings = z.array(ExpectedFinding);

/** Count of the expected-findings skeleton frozen onto a case ("expected N",
 *  AC-7). Tolerates a case whose `expected_output` hasn't been strictly
 *  validated (falls back to a raw array length) rather than throwing. */
export function expectedCount(expectedOutput: unknown): number {
  const parsed = ExpectedFindings.safeParse(expectedOutput);
  if (parsed.success) return parsed.data.length;
  return Array.isArray(expectedOutput) ? expectedOutput.length : 0;
}

/** Count of what the agent actually produced on its last run ("got M", AC-7).
 *  `actual_output` is intentionally `unknown` on the wire (it's whatever the
 *  agent emitted) — only its length is meaningful here. */
export function actualCount(actualOutput: unknown): number {
  return Array.isArray(actualOutput) ? actualOutput.length : 0;
}

/** The first expected finding (severity + category) for a case's row tag.
 *  A case may expect several findings; the row shows just the lead one. */
export function firstExpected(expectedOutput: unknown): ExpectedFinding | null {
  const parsed = ExpectedFindings.safeParse(expectedOutput);
  return parsed.success && parsed.data.length > 0 ? parsed.data[0]! : null;
}

/** Most recent run for one case, drawn from the dashboard's `recent_runs`
 *  feed (see module doc above for why). */
export function latestRunFor(
  caseId: string,
  runs: EvalRunRecord[] | undefined,
): EvalRunRecord | null {
  const forCase = (runs ?? []).filter((r) => r.case_id === caseId);
  if (forCase.length === 0) return null;
  return forCase.reduce((latest, r) =>
    new Date(r.ran_at).getTime() > new Date(latest.ran_at).getTime() ? r : latest,
  );
}

export type CaseStatus = "passed" | "failed" | "never-run";

/** AC-8: a case with no run, or a run whose `pass` is null (server leaves it
 *  unscored rather than inventing a status), is "never run" — distinct from
 *  a genuine fail, and must not show metric numbers. */
export function caseStatus(run: EvalRunRecord | null): CaseStatus {
  if (!run || run.pass == null) return "never-run";
  return run.pass ? "passed" : "failed";
}

/** How many cases currently pass their latest run (design AC-7 header pill
 *  "N / M passing"). Joins `useEvalCases` against the dashboard's
 *  `recent_runs` feed the same way `caseStatus`/`latestRunFor` already do —
 *  never-run and failed cases don't count. */
export function passingCount(cases: EvalCase[], runs: EvalRunRecord[] | undefined): number {
  return cases.filter((c) => caseStatus(latestRunFor(c.id, runs)) === "passed").length;
}

/** Batches most-recent-first. `EvalDashboard.batches` ordering isn't
 *  guaranteed by the contract, so this is sorted defensively rather than
 *  trusted as-is. */
export function sortBatchesDesc(batches: EvalBatchRow[] | undefined): EvalBatchRow[] {
  return [...(batches ?? [])].sort(
    (a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime(),
  );
}

/** Runs most-recent-first, for the run-history list (AC-31). */
export function sortRunsDesc(runs: EvalRunRecord[] | undefined): EvalRunRecord[] {
  return [...(runs ?? [])].sort(
    (a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime(),
  );
}

/** Delta of `traces_passed` between the latest and previous batch. Not
 *  carried by `EvalDashboard.delta` (only recall/precision/citation_accuracy
 *  are), so it's derived here from the batch history for the fourth
 *  metric card (AC-30). `undefined` when there's no previous batch to
 *  compare against. */
export function tracesPassedDelta(batches: EvalBatchRow[] | undefined): number | undefined {
  const sorted = sortBatchesDesc(batches);
  if (sorted.length < 2) return undefined;
  return sorted[0]!.traces_passed - sorted[1]!.traces_passed;
}

/** Whole-percent formatter for a 0..1 fraction, `—` for missing data. */
export function formatPct(v: number | null | undefined): string {
  return v == null ? "—" : `${Math.round(v * 100)}%`;
}

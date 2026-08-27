/* Pure helpers for EvalDashboardView — kept out of the component body so they
   stay trivially testable and don't need mocking. */
import type { EvalAgentSummary, EvalBatchRow } from "@devdigest/shared";

/** Fraction (0..1) → whole-percent string, e.g. 0.823 → "82%". */
export function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Per-metric accent colours, matching the design (recall=blue, precision=green,
 *  citation=amber). Used for the metric values, sparkline, and progress bars so
 *  the same metric reads the same colour everywhere on the dashboard. */
export const METRIC_COLORS = {
  recall: "var(--accent)",
  precision: "var(--ok)",
  citation: "var(--warn)",
} as const;

/** Most-recent-first by `ran_at` (AC-37) — sorted defensively even though the
 *  server already orders `recent_batches`, so the view never depends on it. */
export function sortByRanAtDesc<T extends { ran_at: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime());
}

/** agent_id → agent name, for labelling rows in the cross-agent recent-runs table. */
export function agentNameMap(agents: EvalAgentSummary[]): Record<string, string> {
  return Object.fromEntries(agents.map((a) => [a.agent_id, a.name]));
}

/** Whether every traced case in a batch passed (drives the pass/fail icon + label). */
export function batchFullyPassed(batch: EvalBatchRow): boolean {
  return batch.traces_total > 0 && batch.traces_passed === batch.traces_total;
}

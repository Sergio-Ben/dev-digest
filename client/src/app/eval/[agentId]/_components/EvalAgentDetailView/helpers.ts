/* Pure helpers for EvalAgentDetailView — no React, no I/O, trivially unit
   testable. Kept as a local copy rather than importing the near-identical
   helpers already living in EvalDashboardView/EvalsTab (out of this task's
   owned paths, and re-deriving a handful of one-line formatters here keeps
   this view decoupled from those modules' internals). */
import type { EvalBatchRow } from "@devdigest/shared";

/** Fraction (0..1) -> whole-percent string, e.g. 0.823 -> "82%". */
export function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Most-recent-first by `ran_at`. */
export function sortBatchesDesc(batches: EvalBatchRow[]): EvalBatchRow[] {
  return [...batches].sort((a, b) => new Date(b.ran_at).getTime() - new Date(a.ran_at).getTime());
}

/** ISO timestamp -> "YYYY-MM-DD HH:mm" (design's RAN AT column, rendered in a
 *  monospace/tabular-number font). Uses UTC getters rather than
 *  `toLocaleString()` (the convention elsewhere, e.g. `RecentRunsTable`,
 *  `RunHistoryTable`) so the value is deterministic across timezones,
 *  matching the approved screenshot exactly. */
export function formatRanAt(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/**
 * Toggle a batch id into/out of the "selected for compare" set, capped at
 * exactly two. Unchecking always removes. Checking a third replaces the
 * OLDEST selection (the one selected first, `selected[0]`) rather than
 * disabling the other row checkboxes once two are picked — every row stays
 * keyboard/screen-reader operable at all times instead of toggling a
 * `disabled` state mid-interaction.
 */
export function toggleBatchSelection(selected: string[], batchId: string): string[] {
  if (selected.includes(batchId)) return selected.filter((id) => id !== batchId);
  if (selected.length < 2) return [...selected, batchId];
  return [selected[1]!, batchId];
}

/** Delta value passed straight through to the shared `MetricCard`, which
 *  renders it to 2 decimal places with a signed arrow (e.g. 0.04 -> "↑0.04").
 *  The approved design shows the RAW fraction delta here, NOT percentage
 *  points — unlike EvalsTab's MetricsPanel, which deliberately scales by
 *  100 (`delta.recall * 100`) for its own, differently-designed cards. Kept
 *  as a named passthrough (rather than inlining `dashboard.delta.recall`)
 *  so the intent is documented and the two call sites don't silently drift
 *  back into each other's convention. */
export function deltaPoints(v: number): number {
  return v;
}

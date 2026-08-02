/* Severity ordering + tallying, shared by the PR list's FINDINGS column and the
   PR-detail severity chips. Both surfaces must agree, so the order and the
   counting rule live here rather than in either route. */
import type { FindingRecord, Severity } from "@devdigest/shared";

/** Wire severities, worst first — the render order for chips and counts. */
export const SEVERITY_CHIPS = ["CRITICAL", "WARNING", "SUGGESTION"] as const satisfies readonly Severity[];

/** Sort weight per severity (lower = shown first). INFO is UI-only (see
 *  `@devdigest/ui` tokens) and never arrives on the wire, but findings are
 *  sorted defensively in case it ever does. */
export const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
  INFO: 3,
};

/** Worst-first comparator for a findings list. */
export function bySeverity(a: { severity: string }, b: { severity: string }): number {
  return (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9);
}

/** Tally findings per severity.
 *  Counts are deliberately status- and confidence-independent: accepted and
 *  dismissed findings count, and the per-run "hide low confidence" toggle does
 *  NOT change them — the counts describe the PR, not the current view. This
 *  matches the server's `rollupSeverities` for the PR-list column. */
export function countBySeverity(findings: FindingRecord[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITY_CHIPS.map((s) => [s, 0])) as Record<Severity, number>;
  for (const f of findings) {
    // Unknown severities are ignored so a stray value can't spawn a phantom chip.
    if (f.severity in counts) counts[f.severity] += 1;
  }
  return counts;
}

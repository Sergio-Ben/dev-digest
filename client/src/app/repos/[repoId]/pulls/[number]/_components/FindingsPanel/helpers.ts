import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";
import { bySeverity } from "@/lib/severity";

/** Optionally narrow to one severity, drop low-confidence findings, and sort by
 *  severity. `severity = null` means "no filter" (show every level).
 *
 *  `keepId` exempts one finding from BOTH filters: it's the `?finding=` deep-
 *  link target, and a link that resolves to a filtered-away card looks broken. */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity: Severity | null = null,
  keepId: string | null = null,
): FindingRecord[] {
  let shown = findings;
  if (severity) shown = shown.filter((f) => f.severity === severity || f.id === keepId);
  if (hideLow)
    shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD || f.id === keepId);
  return [...shown].sort(bySeverity);
}

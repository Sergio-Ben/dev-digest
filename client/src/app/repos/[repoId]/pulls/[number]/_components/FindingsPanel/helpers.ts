import type { FindingRecord, Severity } from "@devdigest/shared";
import { LOW_CONFIDENCE_THRESHOLD } from "./constants";
import { bySeverity } from "@/lib/severity";

/** Optionally narrow to one severity, drop low-confidence findings, and sort by
 *  severity. `severity = null` means "no filter" (show every level). */
export function visibleFindings(
  findings: FindingRecord[],
  hideLow: boolean,
  severity: Severity | null = null,
): FindingRecord[] {
  let shown = findings;
  if (severity) shown = shown.filter((f) => f.severity === severity);
  if (hideLow) shown = shown.filter((f) => f.confidence >= LOW_CONFIDENCE_THRESHOLD);
  return [...shown].sort(bySeverity);
}

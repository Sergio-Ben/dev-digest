/** Pure, unit-testable helpers for the Smart Diff viewer. */
import type { PrFile, SmartDiffFile, SmartDiffRole } from "@devdigest/shared";
import { AUTO_EXPAND_MAX_LINES } from "@/components/diff-viewer/constants";
import { DEFAULT_COLLAPSED_ROLES } from "./constants";

/** A file opens by default when either:
 *  - it has findings (an explicit acceptance criterion — findings auto-expand
 *    regardless of role or size), OR
 *  - its role isn't collapsed-by-default AND it's under the diff-viewer's
 *    existing auto-expand line budget. */
export function shouldStartOpen(file: SmartDiffFile, role: SmartDiffRole): boolean {
  if (file.finding_lines.length > 0) return true;
  if (DEFAULT_COLLAPSED_ROLES.includes(role)) return false;
  return file.additions + file.deletions <= AUTO_EXPAND_MAX_LINES;
}

/** Stable, DOM-safe id derived from a file path — used both as a group-file
 *  anchor prefix and (joined with `-L{line}`) as a per-line scroll target. */
export function fileAnchorId(path: string): string {
  return `sd-${path.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

/** The finding anchored at `line` in this file, if any. Several findings can
 *  share a line (two agents flagging the same spot) — the first wins, matching
 *  the order `finding_lines` renders in. */
export function findingIdAtLine(file: SmartDiffFile, line: number): string | undefined {
  return (file.findings ?? []).find((f) => f.line === line)?.id;
}

/** Index PrFiles by path for O(1) join against the SmartDiff's file ordering
 *  (the SmartDiff contract carries no patch text — real diffs come from
 *  `PrFile`, joined here by path). */
export function indexFilesByPath(files: PrFile[]): Map<string, PrFile> {
  return new Map(files.map((f) => [f.path, f]));
}

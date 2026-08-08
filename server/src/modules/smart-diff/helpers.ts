/**
 * Smart Diff — pure grouping / split-suggestion logic.
 *
 * Kept out of `service.ts` (which does I/O) so it is unit-testable without a
 * DB: `groupFiles` and `buildSplitSuggestion` take plain data in, return
 * plain data out.
 */
import type {
  SmartDiffFile,
  SmartDiffFinding,
  SmartDiffGroup,
  SmartDiffRole,
} from '@devdigest/shared';
import { classifyFile, compareFilesForReview, type RankableFile } from './classifier.js';
import {
  ROLE_ORDER,
  SPLIT_MIN_FILES_PER_GROUP,
  SPLIT_TOO_BIG_CORE_FILES,
  SPLIT_TOO_BIG_TOTAL_LINES,
} from './constants.js';

/** Input shape for one PR file, already carrying its computed findings.
 *  `finding_lines` and `findings` describe the same findings in the same
 *  order — the caller builds both from one sorted list. */
export interface SmartDiffFileInput extends RankableFile {
  finding_lines: number[];
  findings: SmartDiffFinding[];
}

/**
 * Classify every file, group by role, and sort each group by review
 * priority. Groups are emitted in `ROLE_ORDER`, but a role with zero files
 * is OMITTED entirely (never emit an empty group).
 */
export function groupFiles(files: SmartDiffFileInput[]): SmartDiffGroup[] {
  const byRole = new Map<SmartDiffRole, SmartDiffFileInput[]>();
  for (const file of files) {
    const role = classifyFile(file.path);
    const list = byRole.get(role);
    if (list) list.push(file);
    else byRole.set(role, [file]);
  }

  const groups: SmartDiffGroup[] = [];
  for (const role of ROLE_ORDER) {
    const roleFiles = byRole.get(role);
    if (!roleFiles || roleFiles.length === 0) continue;
    const sorted = [...roleFiles].sort(compareFilesForReview);
    const dtoFiles: SmartDiffFile[] = sorted.map((f) => ({
      path: f.path,
      // Generating a pseudocode summary would require an LLM call, which
      // this feature explicitly must NOT make — always null.
      pseudocode_summary: null,
      additions: f.additions,
      deletions: f.deletions,
      finding_lines: f.finding_lines,
      findings: f.findings,
    }));
    groups.push({ role, files: dtoFiles });
  }
  return groups;
}

/** Which role a file belongs to, for the split-suggestion grouping below. */
function roleOf(path: string): SmartDiffRole {
  return classifyFile(path);
}

/**
 * Directory prefix used to name a proposed split: first 2 path segments,
 * falling back to 1 for shallow paths (e.g. a root-level file).
 */
function splitPrefix(path: string): string {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length <= 1) return segments[0] ?? path;
  return segments.slice(0, 2).join('/');
}

export interface SplitSuggestionInput {
  path: string;
  additions: number;
  deletions: number;
}

/**
 * `total_lines` = sum of additions+deletions across ALL files (any role).
 * `too_big` fires on either the total-lines threshold or the core-file-count
 * threshold (a PR can bundle many small core files without a huge line
 * count and still be doing too much).
 *
 * `proposed_splits` groups only the CORE files by their directory prefix,
 * keeping groups with at least `SPLIT_MIN_FILES_PER_GROUP` files — wiring
 * and boilerplate files aren't actionable "split out this concern" units.
 * Empty when the PR isn't `too_big`.
 */
export function buildSplitSuggestion(files: SplitSuggestionInput[]): {
  too_big: boolean;
  total_lines: number;
  proposed_splits: { name: string; files: string[] }[];
} {
  const total_lines = files.reduce((sum, f) => sum + f.additions + f.deletions, 0);
  const coreFiles = files.filter((f) => roleOf(f.path) === 'core');
  const too_big =
    total_lines > SPLIT_TOO_BIG_TOTAL_LINES || coreFiles.length > SPLIT_TOO_BIG_CORE_FILES;

  if (!too_big) {
    return { too_big, total_lines, proposed_splits: [] };
  }

  const byPrefix = new Map<string, string[]>();
  for (const f of coreFiles) {
    const prefix = splitPrefix(f.path);
    const list = byPrefix.get(prefix);
    if (list) list.push(f.path);
    else byPrefix.set(prefix, [f.path]);
  }

  const proposed_splits = [...byPrefix.entries()]
    .filter(([, paths]) => paths.length >= SPLIT_MIN_FILES_PER_GROUP)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, paths]) => ({ name, files: [...paths].sort() }));

  return { too_big, total_lines, proposed_splits };
}

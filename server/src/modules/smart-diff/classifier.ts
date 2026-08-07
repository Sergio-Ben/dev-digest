/**
 * Smart Diff — file role classifier.
 *
 * Pure, deterministic, no I/O and no LLM call: `classifyFile` is a plain
 * string → enum function so it is trivially unit-testable and safe to run on
 * every file of every PR without cost or latency.
 */
import type { SmartDiffRole } from '@devdigest/shared';
import {
  BOILERPLATE_DIR_SEGMENTS,
  BOILERPLATE_EXTENSIONS,
  BOILERPLATE_FILENAMES,
  BOILERPLATE_GENERATED_SEGMENT,
  WIRING_DIR_SEGMENTS,
  WIRING_FILENAME_PATTERNS,
  WIRING_FILENAMES,
} from './constants.js';

/** Split a PR file path into POSIX segments, dropping empty ones. */
function segmentsOf(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function basenameOf(path: string): string {
  const segs = segmentsOf(path);
  return segs.length > 0 ? segs[segs.length - 1]! : path;
}

/** Exact, case-insensitive segment membership — never a substring match, so
 * `distribution/foo.ts` does NOT match the `dist` directory rule. */
function hasSegment(segments: string[], candidates: readonly string[]): boolean {
  const lowered = new Set(candidates.map((c) => c.toLowerCase()));
  return segments.some((s) => lowered.has(s.toLowerCase()));
}

function isBoilerplateFile(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (BOILERPLATE_FILENAMES.some((f) => f.toLowerCase() === lower)) return true;
  if (BOILERPLATE_EXTENSIONS.some((ext) => lower.endsWith(ext.toLowerCase()))) return true;
  if (lower.includes(BOILERPLATE_GENERATED_SEGMENT)) return true;
  return false;
}

function isWiringFile(basename: string): boolean {
  const lower = basename.toLowerCase();
  if (WIRING_FILENAMES.some((f) => f.toLowerCase() === lower)) return true;
  if (WIRING_FILENAME_PATTERNS.some((re) => re.test(basename))) return true;
  return false;
}

/**
 * Classify a single PR file path into a review-priority role.
 *
 * Precedence is deliberately `boilerplate → wiring → core` (most specific
 * rule first, `core` is the default fallback). This ordering matters:
 * `dist/index.ts` must land in `boilerplate` (it's a build artifact) even
 * though its basename `index.ts` would otherwise match the `wiring` rule —
 * the directory a file lives in is a stronger signal than its basename.
 */
export function classifyFile(path: string): SmartDiffRole {
  const segments = segmentsOf(path);
  const basename = basenameOf(path);

  if (hasSegment(segments, BOILERPLATE_DIR_SEGMENTS) || isBoilerplateFile(basename)) {
    return 'boilerplate';
  }
  if (hasSegment(segments, WIRING_DIR_SEGMENTS) || isWiringFile(basename)) {
    return 'wiring';
  }
  return 'core';
}

/** Minimal shape the intra-group comparator needs — kept structural so
 * callers (the service) don't have to construct a specific class. */
export interface RankableFile {
  path: string;
  findingsCount: number;
  additions: number;
  deletions: number;
}

/**
 * Intra-group review-priority comparator: files with findings surface first
 * (more findings first — the highest-signal files), then bigger diffs (more
 * additions+deletions), then alphabetically by path for a stable, fully
 * deterministic tie-break.
 */
export function compareFilesForReview(a: RankableFile, b: RankableFile): number {
  if (a.findingsCount !== b.findingsCount) return b.findingsCount - a.findingsCount;
  const aSize = a.additions + a.deletions;
  const bSize = b.additions + b.deletions;
  if (aSize !== bSize) return bSize - aSize;
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/** Sort a copy of `files` by review priority (see `compareFilesForReview`). */
export function rankFiles<T extends RankableFile>(files: T[]): T[] {
  return [...files].sort(compareFilesForReview);
}

/**
 * diff-prompt.ts — shared header-only diff prompt helpers.
 *
 * Extracted from `modules/intent/classifier.ts` so any module that needs a
 * cheap, header-only rendering of a diff (file paths + hunk `@@` headers,
 * never the added/removed body lines) can reuse the exact same logic.
 *
 * Onion layer: application helper (pure — no DB, no HTTP, no LLM calls).
 */
import type { UnifiedDiff } from '@devdigest/shared';

/**
 * Coarse token count estimate: ceil(chars / 4).
 * Deliberately approximate — labeled "~" in all log output.
 */
export function estimateTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

/** Reconstruct a hunk header line from its parsed fields. */
export function hunkHeader(hunk: {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

/**
 * Render the `## Changed files`-style body: for each file, a `### <path>`
 * heading followed by one hunk header line per hunk. Never includes any
 * added/removed source line (no `+`/`-`-prefixed diff body content).
 */
export function changedFilesSection(diff: UnifiedDiff): string {
  const fileLines: string[] = [];
  for (const file of diff.files) {
    fileLines.push(`### ${file.path}`);
    for (const hunk of file.hunks) {
      fileLines.push(hunkHeader(hunk));
    }
  }
  return fileLines.join('\n');
}

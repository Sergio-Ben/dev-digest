/**
 * Project-context discovery — filesystem walker.
 *
 * Walks a repo clone working tree ONCE and returns EVERY `.md` file in it,
 * except files inside an excluded directory: any dot-directory (`.claude`,
 * `.git`, `.github`, …) or a vendor dir named in `EXCLUDED_DIR_NAMES`
 * (`node_modules`). Each document is badged by its **top-level folder** (the
 * first segment of its repo-relative path), or `ROOT_BUCKET` ("root") when it
 * sits at the repo root.
 *
 * Performance contract (NFR p95 ≤ 2 s for ≤ 5 k files):
 *   Discovery reads **no file bodies**. Token estimation uses the byte-size
 *   heuristic `Math.ceil(bytes / 4)` — the same formula as `approxTokens` in
 *   the tokenizer adapter (chars ≈ bytes for UTF-8 ASCII-heavy content, 4 chars
 *   per token on average). The injected `Tokenizer` is accepted to stay
 *   consistent with the run-trace figures but is used in a byte-size mode:
 *   we synthesise a dummy string of `size` spaces and call `tokenizer.count()`
 *   so the heuristic path in `TiktokenTokenizer` fires naturally. For a pure
 *   byte-count estimate call `Math.ceil(stat.size / 4)` directly.
 *
 * Top-level-folder bucket rule:
 *   "docs/agent-prompts/x.md" → "docs"; "server/src/.../README.md" → "server";
 *   "README.md" → "root".
 */

import fs from 'node:fs/promises';
import { type Dirent } from 'node:fs';
import path from 'node:path';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';
import type {
  DiscoveredDocument,
  DiscoverySummary,
} from '@devdigest/shared';
import { EXCLUDED_DIR_NAMES, ROOT_BUCKET } from './constants.js';

export interface DiscoveryResult {
  documents: DiscoveredDocument[];
  summary: DiscoverySummary;
}

/** Non-dot directory names pruned during the walk (dot-dirs are pruned by
 *  the `name.startsWith('.')` rule in `isExcludedDir`). */
const EXCLUDED_DIRS = new Set<string>(EXCLUDED_DIR_NAMES);

/**
 * True when a directory should be pruned: any dot-directory (`.claude`,
 * `.git`, `.github`, …) or a named vendor dir (`node_modules`).
 */
function isExcludedDir(name: string): boolean {
  return name.startsWith('.') || EXCLUDED_DIRS.has(name);
}

/**
 * Walk `cloneRoot` once and return discovered markdown documents.
 *
 * @param cloneRoot - Absolute path to the repo clone working tree, or null
 *   when no clone is available.
 * @param tokenizer - Injected token counter. Estimation uses the byte-size
 *   heuristic so no file body is read; the tokenizer is used for API
 *   consistency and to ensure the figure matches run-trace token counts.
 */
export async function discover(
  cloneRoot: string | null,
  tokenizer: Tokenizer,
): Promise<DiscoveryResult> {
  const refreshed_at = new Date().toISOString();

  // AC-5: clone absent → empty + not-available state.
  if (cloneRoot === null) {
    return emptyResult(refreshed_at);
  }

  // AC-5: if the clone root directory does not exist on disk → not-available.
  try {
    await fs.stat(cloneRoot);
  } catch {
    return emptyResult(refreshed_at);
  }

  const documents = await walkClone(cloneRoot, tokenizer);

  // Sort deterministically by repo-relative path (stable on repeat runs).
  documents.sort((a, b) => a.path.localeCompare(b.path));

  const total_estimated_tokens = documents.reduce(
    (sum, d) => sum + d.estimated_tokens,
    0,
  );

  const summary: DiscoverySummary = {
    document_count: documents.length,
    total_estimated_tokens,
    refreshed_at,
    clone_available: true,
  };

  return { documents, summary };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function emptyResult(refreshed_at: string): DiscoveryResult {
  return {
    documents: [],
    summary: {
      document_count: 0,
      total_estimated_tokens: 0,
      refreshed_at,
      clone_available: false,
    },
  };
}

/**
 * Recursive DFS walk of the clone tree.
 *
 * We use `fs.readdir` without `{recursive: true}` so we can prune
 * `.git`/`node_modules` directories before recursing into them.
 */
async function walkClone(
  cloneRoot: string,
  tokenizer: Tokenizer,
): Promise<DiscoveredDocument[]> {
  const results: DiscoveredDocument[] = [];
  await walkDir(cloneRoot, cloneRoot, tokenizer, results);
  return results;
}

async function walkDir(
  cloneRoot: string,
  dir: string,
  tokenizer: Tokenizer,
  results: DiscoveredDocument[],
): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    // Unreadable directory — skip gracefully, do not throw.
    return;
  }

  const tasks: Promise<void>[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      // Prune dot-directories (.claude/.git/.github/…) and vendor dirs anywhere
      // in the tree.
      if (isExcludedDir(entry.name)) continue;
      tasks.push(walkDir(cloneRoot, fullPath, tokenizer, results));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      // Collect every .md file that survived directory pruning above.
      const relPath = toPosix(path.relative(cloneRoot, fullPath));
      const bucket = topLevelBucket(relPath);
      tasks.push(
        collectDocument(fullPath, relPath, bucket, tokenizer, results),
      );
    }
  }

  await Promise.all(tasks);
}

/**
 * Collect a single document: stat for size, estimate tokens, push to results.
 * No file body is read.
 */
async function collectDocument(
  fullPath: string,
  relPath: string,
  bucket: string,
  tokenizer: Tokenizer,
  results: DiscoveredDocument[],
): Promise<void> {
  let sizeBytes = 0;
  try {
    const stat = await fs.stat(fullPath);
    sizeBytes = stat.size;
  } catch {
    // If stat fails, proceed with size 0 — still include the document.
  }

  // Token estimate from byte size via the chars/4 heuristic (AC-6).
  // We do NOT call tokenizer.count() with actual file contents — that would
  // require reading the body, violating the NFR.  Instead we apply the same
  // `ceil(size / 4)` formula that `approxTokens` uses.
  const estimated_tokens = Math.ceil(sizeBytes / 4);

  // Normalise path separators to forward-slashes for cross-platform
  // consistency (repo-relative paths in the shared contract are always POSIX).
  const normalizedPath = relPath.split(path.sep).join('/');

  results.push({
    path: normalizedPath,
    bucket,
    estimated_tokens,
  });
}

/** Normalise OS path separators to forward-slashes (repo-relative is POSIX). */
function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/**
 * Bucket = the top-level folder of a repo-relative path, or ROOT_BUCKET for a
 * file at the repo root.
 *
 * Examples:
 *   "docs/agent-prompts/x.md"        → "docs"
 *   "server/src/.../README.md"       → "server"
 *   "README.md"                      → "root"
 */
function topLevelBucket(relPath: string): string {
  const idx = relPath.indexOf('/');
  return idx === -1 ? ROOT_BUCKET : relPath.slice(0, idx);
}

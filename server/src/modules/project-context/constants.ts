/**
 * Project-context discovery configuration.
 *
 * Discovery walks the repo clone and returns EVERY `.md` file, badged by its
 * top-level folder, except files inside an excluded directory:
 *   - any dot-directory (name starting with ".") — e.g. `.claude`, `.git`,
 *     `.github`, `.vscode`: config/tooling folders, not project docs;
 *   - the vendor/build directories named in `EXCLUDED_DIR_NAMES`.
 *
 * Add a name to `EXCLUDED_DIR_NAMES` to hide another non-dot vendor tree.
 */

// Re-export the canonical type from the shared contract so callers only need
// one import path. `BucketName` is now a free-form string (the top-level
// folder name) — see contracts/project-context.ts.
export type { BucketName } from '@devdigest/shared';

/**
 * Non-dot directory names pruned anywhere in the tree. Dot-directories are
 * excluded by a separate rule (name starting with "."), so they are not
 * listed here.
 */
export const EXCLUDED_DIR_NAMES = ['node_modules'] as const;

/** Bucket badge for `.md` files that sit at the repo root (no folder). */
export const ROOT_BUCKET = 'root';

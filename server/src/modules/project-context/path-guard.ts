/**
 * Path-traversal and symlink-escape guard for clone working-tree access.
 *
 * AC-30: every read AND write into a repo clone working tree must pass through
 * one of these two functions so that path-traversal (`../`) and out-of-tree
 * symlinks cannot escape the clone root.
 *
 * Both functions are pure from the caller's perspective (no side effects beyond
 * the fs.realpath call) and throw ValidationError on any violation so callers
 * can map it to 400 without catching a generic Error.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from '../../platform/errors.js';

/**
 * Validate that `relPath` resolves to a location inside `cloneRoot` and that
 * no symlink along the resolved path escapes the tree.
 *
 * Rejects:
 *  - absolute `relPath` (starts with `/`)
 *  - any `relPath` whose normalised form contains a `..` segment
 *  - a resolved path whose fs.realpath is outside `cloneRoot`
 *
 * The target file **must already exist** on disk (fs.realpath requires it).
 * For writes where the target file may not yet exist, use assertInsideCloneForWrite.
 *
 * @returns the validated absolute path
 * @throws ValidationError for any violation
 */
export async function assertInsideClone(
  cloneRoot: string,
  relPath: string,
): Promise<string> {
  rejectDangerousRelPath(relPath);

  const resolved = path.resolve(cloneRoot, relPath);

  // Realpath both sides so symlinks are expanded before comparison.
  const [realRoot, realTarget] = await Promise.all([
    safeRealpath(cloneRoot, 'clone root'),
    safeRealpath(resolved, `path "${relPath}"`),
  ]);

  assertContained(realRoot, realTarget, relPath);
  return realTarget;
}

/**
 * Like assertInsideClone but tolerates a not-yet-existing target file.
 *
 * When the target does not exist we realpath the **parent directory** instead.
 * This allows creating a brand-new file inside the tree while still blocking a
 * symlinked parent that points outside the clone root.
 *
 * @returns the validated absolute path (target; may not exist yet)
 * @throws ValidationError for any violation
 */
export async function assertInsideCloneForWrite(
  cloneRoot: string,
  relPath: string,
): Promise<string> {
  rejectDangerousRelPath(relPath);

  const resolved = path.resolve(cloneRoot, relPath);

  let realTarget: string;
  try {
    // Happy path: the file already exists — full realpath check.
    realTarget = await fs.realpath(resolved);
  } catch {
    // File does not exist yet — check the parent directory instead.
    const parentDir = path.dirname(resolved);
    const realParent = await safeRealpath(parentDir, `parent of "${relPath}"`);

    const realRoot = await safeRealpath(cloneRoot, 'clone root');
    assertContained(realRoot, realParent, relPath);

    // The target itself is the join of the validated parent + the filename.
    realTarget = path.join(realParent, path.basename(resolved));
    return realTarget;
  }

  const realRoot = await safeRealpath(cloneRoot, 'clone root');
  assertContained(realRoot, realTarget, relPath);
  return realTarget;
}

// ---------------------------------------------------------------------------
// Helpers (not exported — implementation detail)
// ---------------------------------------------------------------------------

/**
 * Reject a relPath that is absolute or that, when normalised, contains a `..`
 * component.  String-only check — necessary but not sufficient (symlinks can
 * still escape), which is why the realpath containment check follows.
 */
function rejectDangerousRelPath(relPath: string): void {
  if (path.isAbsolute(relPath)) {
    throw new ValidationError(
      `Path must be relative, got absolute path: "${relPath}"`,
    );
  }

  // Normalise the path and check each segment.  We use path.normalize so that
  // `a//b`, `./a/../b` etc. are collapsed before the check.
  const normalised = path.normalize(relPath);
  const segments = normalised.split(path.sep);
  if (segments.includes('..')) {
    throw new ValidationError(
      `Path must not contain ".." components: "${relPath}"`,
    );
  }
}

/**
 * Wrap fs.realpath with a meaningful ValidationError instead of a raw ENOENT.
 */
async function safeRealpath(target: string, label: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code ?? 'UNKNOWN';
    throw new ValidationError(
      `Cannot resolve real path of ${label} (${code}): "${target}"`,
    );
  }
}

/**
 * Assert that `realTarget` is equal to `realRoot` or starts with
 * `realRoot + path.sep`.  A bare prefix match (without the sep) would falsely
 * allow `/clone-root-extra/file` when `realRoot` is `/clone-root`.
 */
function assertContained(
  realRoot: string,
  realTarget: string,
  relPath: string,
): void {
  if (
    realTarget !== realRoot &&
    !realTarget.startsWith(realRoot + path.sep)
  ) {
    throw new ValidationError(
      `Path "${relPath}" resolves outside the clone root (symlink escape or traversal attempt)`,
    );
  }
}

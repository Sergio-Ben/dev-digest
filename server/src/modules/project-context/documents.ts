/**
 * Guarded document read/write for clone working-tree files.
 *
 * Both functions route through the T3 path-guard before any filesystem
 * operation, so the same AC-30 boundary covers Preview reads, Edit-save
 * writes, and run-time injection reads.
 *
 * IMPORTANT: Do NOT replace these with `git.readFile(repo, path)` — that
 * method is unguarded (bare readFile without traversal/symlink checks).
 *
 * Write performs NO git operation (no add/commit/push). Uncommitted edits
 * to git-tracked files will be clobbered by the next `git reset --hard`
 * (a UI warning, not handled here — see T12/T13).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { GitClient, RepoRef } from '../../vendor/shared/adapters.js';
import {
  assertInsideClone,
  assertInsideCloneForWrite,
} from './path-guard.js';

/**
 * Read a text file from the clone working tree.
 *
 * Resolves `cloneRoot` via `git.clonePathFor(repoRef)`, validates the path
 * through `assertInsideClone` (blocks traversal and symlink-escape), then
 * reads the file as UTF-8.
 *
 * @throws {ValidationError}   if `filePath` is absolute, contains `..`, or
 *                             resolves outside the clone root (symlink escape).
 * @throws {Error}             if the file does not exist (ENOENT) or is not
 *                             readable — callers should catch and record the
 *                             skip (AC-22 fail-soft requirement).
 */
export async function readDocument(
  git: GitClient,
  repoRef: RepoRef,
  filePath: string,
): Promise<string> {
  const cloneRoot = git.clonePathFor(repoRef);

  // assertInsideClone requires the file to already exist (it realpaths the
  // target). A missing file will throw with an ENOENT-based ValidationError so
  // callers can distinguish "guard violation" (400) from "file missing" (skip).
  const validatedPath = await assertInsideClone(cloneRoot, filePath);

  return fs.readFile(validatedPath, 'utf8');
}

/**
 * Write text to a file in the clone working tree.
 *
 * Resolves `cloneRoot` via `git.clonePathFor(repoRef)`, validates the path
 * through `assertInsideCloneForWrite` (tolerates a not-yet-existing target
 * file but still blocks traversal and symlinked parent dirs outside the
 * clone), then writes the content as UTF-8.
 *
 * The parent directory of the target **must already exist** — this function
 * does not create intermediate directories.  If the parent is absent the
 * underlying `fs.writeFile` will throw an ENOENT error so the caller can
 * surface a clear save-failure to the user (AC requirement: do not silently
 * swallow write errors).
 *
 * No git operation is performed (no add/commit/push).
 *
 * @throws {ValidationError}   if `filePath` is absolute, contains `..`, or
 *                             resolves outside the clone root (symlink escape).
 * @throws {Error}             if the parent directory does not exist or the
 *                             file is not writable.
 */
export async function writeDocument(
  git: GitClient,
  repoRef: RepoRef,
  filePath: string,
  text: string,
): Promise<void> {
  const cloneRoot = git.clonePathFor(repoRef);

  // assertInsideCloneForWrite realpaths the parent dir when the target file
  // does not yet exist — this allows brand-new files while blocking symlinked
  // parents that point outside the clone root.
  const validatedPath = await assertInsideCloneForWrite(cloneRoot, filePath);

  // Verify the parent directory exists; fs.writeFile would throw ENOENT
  // anyway, but we provide an explicit message so callers can surface a
  // clearer save-failure rather than a raw ENOENT.
  const parentDir = path.dirname(validatedPath);
  try {
    await fs.access(parentDir);
  } catch {
    throw new Error(
      `Cannot write "${filePath}": parent directory does not exist (${parentDir})`,
    );
  }

  await fs.writeFile(validatedPath, text, 'utf8');
}

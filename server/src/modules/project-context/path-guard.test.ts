/**
 * Unit tests for path-guard.ts (AC-30)
 *
 * Both `assertInsideClone` (read) and `assertInsideCloneForWrite` (write) must:
 *  - reject traversal paths (../../etc/passwd)
 *  - reject absolute paths (/etc/passwd)
 *  - reject symlinks that escape the clone root
 *  - accept in-tree relative paths
 *
 * For symlink tests we create real temp dirs + real symlinks because
 * `fs.realpath` actually stats the filesystem — it cannot be mocked at the
 * path-guard level without defeating the test's purpose.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { assertInsideClone, assertInsideCloneForWrite } from './path-guard.js';
import { ValidationError } from '../../platform/errors.js';

// ---------------------------------------------------------------------------
// Temp-dir lifecycle
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pg-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  // Clean up every temp dir created in each test.
  for (const d of tmpDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// assertInsideClone — read guard
// ---------------------------------------------------------------------------

describe('assertInsideClone (read)', () => {
  it('accepts an in-tree path that exists', async () => {
    // an existing docs/x.md inside the clone must be accepted
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);
    await fs.writeFile(path.join(docsDir, 'x.md'), 'hello');

    const result = await assertInsideClone(root, 'docs/x.md');
    // realpath on macOS resolves /var → /private/var; use realpath for the expected path too
    const realRoot = await fs.realpath(root);
    expect(result).toBe(path.join(realRoot, 'docs', 'x.md'));
  });

  it('rejects a traversal path (../../etc/passwd)', async () => {
    const root = await makeTmpDir();
    // traversal path must be rejected before any filesystem access
    await expect(
      assertInsideClone(root, '../../etc/passwd'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an absolute path (/etc/passwd)', async () => {
    const root = await makeTmpDir();
    await expect(
      assertInsideClone(root, '/etc/passwd'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a traversal disguised with double-dots after a subdir', async () => {
    // e.g. docs/../../../etc/passwd — should normalise and detect ..
    const root = await makeTmpDir();
    await expect(
      assertInsideClone(root, 'docs/../../../etc/passwd'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a symlink that escapes the clone root', async () => {
    // Build a two-dir setup: cloneRoot and a separate outsideDir
    // cloneRoot/link -> outsideDir/secret.md
    const root = await makeTmpDir();
    const outside = await makeTmpDir();
    const secretFile = path.join(outside, 'secret.md');
    await fs.writeFile(secretFile, 'top secret');

    // symlink inside the clone pointing outside
    const linkPath = path.join(root, 'link.md');
    await fs.symlink(secretFile, linkPath);

    // resolves to a real file, but outside the clone root — must be rejected
    await expect(
      assertInsideClone(root, 'link.md'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a missing file (ENOENT) as ValidationError', async () => {
    const root = await makeTmpDir();
    // file does not exist → realpath will fail → ValidationError
    await expect(
      assertInsideClone(root, 'nonexistent.md'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// assertInsideCloneForWrite — write guard
// ---------------------------------------------------------------------------

describe('assertInsideCloneForWrite (write)', () => {
  it('accepts an in-tree path for an existing file', async () => {
    // an existing docs/x.md inside the clone must be accepted for write
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);
    await fs.writeFile(path.join(docsDir, 'x.md'), 'original');

    const result = await assertInsideCloneForWrite(root, 'docs/x.md');
    // realpath on macOS resolves /var → /private/var; use realpath for the expected path too
    const realRoot = await fs.realpath(root);
    expect(result).toBe(path.join(realRoot, 'docs', 'x.md'));
  });

  it('accepts a brand-new in-tree file (parent exists, file does not)', async () => {
    // brand-new file creation must be allowed for write
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);

    // docs/new.md does not exist yet — parent dir exists
    const result = await assertInsideCloneForWrite(root, 'docs/new.md');
    // realpath on macOS resolves /var → /private/var; use realpath for expected path
    const realRoot = await fs.realpath(root);
    expect(result).toBe(path.join(realRoot, 'docs', 'new.md'));
  });

  it('rejects a traversal path (../../etc/passwd)', async () => {
    const root = await makeTmpDir();
    await expect(
      assertInsideCloneForWrite(root, '../../etc/passwd'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects an absolute path (/etc/passwd)', async () => {
    const root = await makeTmpDir();
    await expect(
      assertInsideCloneForWrite(root, '/etc/passwd'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a symlink target that escapes the clone root', async () => {
    // Existing file that is a symlink to outside
    const root = await makeTmpDir();
    const outside = await makeTmpDir();
    const secretFile = path.join(outside, 'secret.md');
    await fs.writeFile(secretFile, 'top secret');

    const linkPath = path.join(root, 'link.md');
    await fs.symlink(secretFile, linkPath);

    // resolves to an existing file outside the clone root — must be rejected
    await expect(
      assertInsideCloneForWrite(root, 'link.md'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a symlinked parent directory that escapes the clone root', async () => {
    // Parent dir of the target is a symlink pointing outside
    const root = await makeTmpDir();
    const outside = await makeTmpDir();

    // cloneRoot/leaked -> outsideDir (a real directory)
    const linkDir = path.join(root, 'leaked');
    await fs.symlink(outside, linkDir);

    // leaked/new.md: the file does not exist but parent (symlink) is outside
    await expect(
      assertInsideCloneForWrite(root, 'leaked/new.md'),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

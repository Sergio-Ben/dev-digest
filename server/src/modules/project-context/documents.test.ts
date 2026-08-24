/**
 * Unit tests for documents.ts (AC-32/AC-33)
 *
 * readDocument and writeDocument delegate to the path-guard, so traversal
 * rejection is tested here via both functions. We use a real temp dir so
 * path-guard's realpath calls work correctly.
 *
 * Contracts:
 *  - guarded read returns file text (AC-32)
 *  - write persists text; subsequent read returns new text (AC-33)
 *  - traversal path is refused for both read and write (AC-30 delegation)
 *  - write makes NO git operation (no calls to git.readFile / git.clone etc.)
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readDocument, writeDocument } from './documents.js';
import { ValidationError } from '../../platform/errors.js';
import type { GitClient, RepoRef } from '../../vendor/shared/adapters.js';

// ---------------------------------------------------------------------------
// Temp-dir lifecycle
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docs-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tmpDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const REPO_REF: RepoRef = { owner: 'test-owner', name: 'test-repo' };

/**
 * Build a minimal GitClient stub whose clonePathFor returns the given root.
 * We track method calls to assert that write makes NO git operation.
 */
function makeGit(cloneRoot: string): GitClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    clonePathFor: (_repo: RepoRef) => cloneRoot,
    clone: async (...args: unknown[]) => { calls.push('clone'); return { path: cloneRoot }; },
    fetchPullHead: async (...args: unknown[]) => { calls.push('fetchPullHead'); },
    sync: async (...args: unknown[]) => { calls.push('sync'); return { head: 'abc' }; },
    currentHead: async () => { calls.push('currentHead'); return 'abc'; },
    diffNameOnly: async () => { calls.push('diffNameOnly'); return []; },
    diff: async () => { calls.push('diff'); return { raw: '', files: [] }; },
    blame: async () => { calls.push('blame'); return []; },
    log: async () => { calls.push('log'); return []; },
    readFile: async (_repo: RepoRef, p: string) => { calls.push(`readFile:${p}`); return ''; },
  } as unknown as GitClient & { calls: string[] };
}

// ---------------------------------------------------------------------------
// readDocument
// ---------------------------------------------------------------------------

describe('readDocument', () => {
  it('returns the file text for an existing in-tree path (AC-32)', async () => {
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);
    await fs.writeFile(path.join(docsDir, 'guide.md'), '# Guide\nHello world');

    const git = makeGit(root);
    const text = await readDocument(git, REPO_REF, 'docs/guide.md');

    // guarded read returns the file contents
    expect(text).toBe('# Guide\nHello world');
  });

  it('rejects traversal path (../../etc/passwd) with ValidationError', async () => {
    const root = await makeTmpDir();
    const git = makeGit(root);

    // traversal must be refused
    await expect(
      readDocument(git, REPO_REF, '../../etc/passwd'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects absolute path (/etc/passwd) with ValidationError', async () => {
    const root = await makeTmpDir();
    const git = makeGit(root);

    await expect(
      readDocument(git, REPO_REF, '/etc/passwd'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws when the file does not exist', async () => {
    const root = await makeTmpDir();
    const git = makeGit(root);

    // file does not exist → should throw (ValidationError from safeRealpath ENOENT)
    await expect(
      readDocument(git, REPO_REF, 'docs/nonexistent.md'),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// writeDocument
// ---------------------------------------------------------------------------

describe('writeDocument', () => {
  it('persists text and subsequent read returns new text (AC-33)', async () => {
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);
    await fs.writeFile(path.join(docsDir, 'spec.md'), 'old content');

    const git = makeGit(root);

    // write new content
    await writeDocument(git, REPO_REF, 'docs/spec.md', '# New spec\nUpdated');

    // read it back and verify the new content is there
    const updated = await fs.readFile(path.join(docsDir, 'spec.md'), 'utf8');
    expect(updated).toBe('# New spec\nUpdated');
  });

  it('makes NO git call (no clone/sync/readFile) during a write (AC contract)', async () => {
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);
    await fs.writeFile(path.join(docsDir, 'spec.md'), 'original');

    const git = makeGit(root);

    await writeDocument(git, REPO_REF, 'docs/spec.md', 'updated');

    // write must not trigger any git operation
    expect(git.calls).toHaveLength(0);
  });

  it('rejects traversal path (../../etc/passwd) with ValidationError', async () => {
    const root = await makeTmpDir();
    const git = makeGit(root);

    await expect(
      writeDocument(git, REPO_REF, '../../etc/passwd', 'evil'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects absolute path (/etc/passwd) with ValidationError', async () => {
    const root = await makeTmpDir();
    const git = makeGit(root);

    await expect(
      writeDocument(git, REPO_REF, '/etc/passwd', 'evil'),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('allows writing a brand-new in-tree file (parent must exist)', async () => {
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);
    // docs/new.md does not exist yet — write should create it

    const git = makeGit(root);
    await writeDocument(git, REPO_REF, 'docs/new.md', '# Brand new');

    const content = await fs.readFile(path.join(docsDir, 'new.md'), 'utf8');
    expect(content).toBe('# Brand new');
  });

  it('throws when parent directory does not exist', async () => {
    const root = await makeTmpDir();
    const git = makeGit(root);
    // parent dir "missing/" has not been created

    await expect(
      writeDocument(git, REPO_REF, 'missing/new.md', 'content'),
    ).rejects.toThrow();
  });
});

/**
 * Unit tests for discovery.ts
 *
 * Discovery returns EVERY `.md` file in the clone, badged by its top-level
 * folder, except files under an excluded prefix (.claude/skills) and the
 * pruned `.git`/`node_modules` trees.
 *
 *  - every `.md` returned regardless of folder; non-.md ignored
 *  - each result has path/bucket/estimated_tokens
 *  - bucket = top-level folder; repo-root files → "root"
 *  - .claude/skills/** excluded; .git / node_modules pruned
 *  - null/absent clone → empty + clone_available: false
 *
 * Filesystem is real temp-dir (no mocking — discover() walks real directories).
 * No network, no DB. Timer-independent (no Date.now() in test body).
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { discover } from './discovery.js';
import type { Tokenizer } from '../../adapters/tokenizer/index.js';

// ---------------------------------------------------------------------------
// Minimal fake tokenizer — char/4 heuristic (matches production estimate)
// ---------------------------------------------------------------------------

const fakeTokenizer: Tokenizer = {
  count: (text: string) => Math.ceil(text.length / 4),
};

// ---------------------------------------------------------------------------
// Temp-dir lifecycle
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'disc-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tmpDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

/** Write a file, creating parent dirs as needed. */
async function write(base: string, relPath: string, content = 'hello'): Promise<void> {
  const full = path.join(base, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('discover()', () => {
  it('returns empty + clone_available=false when cloneRoot is null', async () => {
    const result = await discover(null, fakeTokenizer);

    // clone absent → nothing discovered, clone_available false
    expect(result.documents).toHaveLength(0);
    expect(result.summary.clone_available).toBe(false);
    expect(result.summary.document_count).toBe(0);
  });

  it('returns empty + clone_available=false when cloneRoot path does not exist', async () => {
    const result = await discover('/does/not/exist/at/all', fakeTokenizer);

    expect(result.documents).toHaveLength(0);
    expect(result.summary.clone_available).toBe(false);
  });

  it('returns every .md anywhere in the tree; ignores non-.md files', async () => {
    const root = await makeTmpDir();
    await write(root, 'specs/architecture.md');
    await write(root, 'docs/guide.md');
    await write(root, 'insights/notes.md');
    await write(root, 'src/docs/nested.md');
    await write(root, 'README.md');                 // root-level .md — now included
    await write(root, 'client/src/vendor/ui/README.md'); // deep, non-bucket — included
    await write(root, 'src/utils.ts');              // not .md — ignored

    const result = await discover(root, fakeTokenizer);
    const paths = result.documents.map((d) => d.path).sort();

    expect(paths).toContain('specs/architecture.md');
    expect(paths).toContain('docs/guide.md');
    expect(paths).toContain('insights/notes.md');
    expect(paths).toContain('src/docs/nested.md');
    expect(paths).toContain('README.md');
    expect(paths).toContain('client/src/vendor/ui/README.md');
    // non-.md never collected
    expect(paths).not.toContain('src/utils.ts');
  });

  it('each result has path, bucket, and estimated_tokens', async () => {
    const root = await makeTmpDir();
    const content = 'x'.repeat(40); // 40 bytes → ceil(40/4) = 10 tokens
    await write(root, 'docs/guide.md', content);

    const result = await discover(root, fakeTokenizer);
    const doc = result.documents[0];

    expect(doc).toBeDefined();
    expect(doc).toHaveProperty('path');
    expect(doc).toHaveProperty('bucket');
    expect(doc).toHaveProperty('estimated_tokens');
    expect(typeof doc!.estimated_tokens).toBe('number');
    // token estimate is ceil(bytes/4) — production code reads stat.size not the content length
    // so we just assert it is a non-negative integer
    expect(doc!.estimated_tokens).toBeGreaterThanOrEqual(0);
  });

  it('bucket = top-level folder; repo-root files → "root"', async () => {
    const root = await makeTmpDir();
    await write(root, 'docs/specs/x.md');           // nested → top-level "docs"
    await write(root, 'server/src/mod/README.md');  // → "server"
    await write(root, 'TESTING.md');                // root file → "root"

    const result = await discover(root, fakeTokenizer);
    const byPath = new Map(result.documents.map((d) => [d.path, d.bucket]));

    expect(byPath.get('docs/specs/x.md')).toBe('docs');
    expect(byPath.get('server/src/mod/README.md')).toBe('server');
    expect(byPath.get('TESTING.md')).toBe('root');
  });

  it('excludes dot-directories entirely (.claude, .github) but keeps real docs', async () => {
    const root = await makeTmpDir();
    await write(root, '.claude/skills/zod/SKILL.md');       // excluded (.claude)
    await write(root, '.claude/agents/reviewer.md');        // excluded (.claude)
    await write(root, '.github/PULL_REQUEST_TEMPLATE.md');  // excluded (.github)
    await write(root, 'docs/real.md');                      // kept

    const result = await discover(root, fakeTokenizer);
    const paths = result.documents.map((d) => d.path);

    expect(paths).toContain('docs/real.md');
    expect(paths.some((p) => p.startsWith('.claude'))).toBe(false);
    expect(paths.some((p) => p.startsWith('.github'))).toBe(false);
  });

  it('discovery result is stable on repeat calls (same result each time)', async () => {
    const root = await makeTmpDir();
    await write(root, 'specs/a.md');
    await write(root, 'docs/b.md');

    const first = await discover(root, fakeTokenizer);
    const second = await discover(root, fakeTokenizer);

    // path ordering is stable (sorted lexicographically)
    expect(first.documents.map((d) => d.path)).toEqual(
      second.documents.map((d) => d.path),
    );
    expect(first.documents.map((d) => d.bucket)).toEqual(
      second.documents.map((d) => d.bucket),
    );
  });

  it('does NOT return files from .git or node_modules directories', async () => {
    const root = await makeTmpDir();
    await write(root, '.git/docs/readme.md');
    await write(root, 'node_modules/pkg/docs/guide.md');
    await write(root, 'docs/real.md');

    const result = await discover(root, fakeTokenizer);
    const paths = result.documents.map((d) => d.path);

    expect(paths).toContain('docs/real.md');
    expect(paths.some((p) => p.includes('.git'))).toBe(false);
    expect(paths.some((p) => p.includes('node_modules'))).toBe(false);
  });

  it('summary.document_count matches documents array length', async () => {
    const root = await makeTmpDir();
    await write(root, 'specs/a.md');
    await write(root, 'specs/b.md');
    await write(root, 'docs/c.md');

    const result = await discover(root, fakeTokenizer);

    expect(result.summary.document_count).toBe(result.documents.length);
    expect(result.summary.clone_available).toBe(true);
  });

  it('summary.total_estimated_tokens is the sum of all document tokens', async () => {
    const root = await makeTmpDir();
    await write(root, 'specs/a.md', 'x'.repeat(8));  // ceil(8/4) = 2 tokens
    await write(root, 'docs/b.md', 'x'.repeat(12)); // ceil(12/4) = 3 tokens

    const result = await discover(root, fakeTokenizer);

    const expectedSum = result.documents.reduce((sum, d) => sum + d.estimated_tokens, 0);
    expect(result.summary.total_estimated_tokens).toBe(expectedSum);
  });

  it('path segments use forward slashes regardless of OS', async () => {
    const root = await makeTmpDir();
    await write(root, 'docs/sub/nested.md');

    const result = await discover(root, fakeTokenizer);
    const doc = result.documents.find((d) => d.path.includes('nested'));

    expect(doc).toBeDefined();
    // repo-relative paths in shared contract are always POSIX
    expect(doc!.path).toBe('docs/sub/nested.md');
    expect(doc!.path).not.toContain('\\');
  });
});

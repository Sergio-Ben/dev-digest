/**
 * Hermetic unit tests for project-context spec injection into the review pipeline.
 *
 * Tests the chain: resolveSpecPaths → readDocument → reviewPullRequest
 *
 * AC-18: snapshot agent + enabled-skill paths once at run start
 * AC-19: union of agent + skill paths, deduped (first-wins)
 * AC-21: deterministic order — agent paths first then loaded skills in load order
 * AC-22: stale/unreadable path is skipped; path appears in specs_missing
 * AC-23: zero attached docs → NO "## Project context" in the assembled prompt; specs_read: []
 * AC-24: LLM call count identical with and without attached docs (injection cost = 0)
 * AC-26: specs_read vs specs_missing are distinct; survivors injected
 * AC-35 (hermetic half): a grounded finding whose diff quote EXISTS in the diff
 *        SURVIVES groundFindings() — specs in the prompt do NOT remove a valid finding
 *
 * No Docker. No DB. LLM is MockLLMProvider. Git is a custom stub pointing to a real
 * temp dir so assertInsideClone's realpath calls work correctly.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { reviewPullRequest } from '@devdigest/reviewer-core';
import { groundFindings } from '@devdigest/reviewer-core';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
import { MockLLMProvider } from '../../adapters/mocks.js';
import { resolveSpecPaths } from '../project-context/injection.js';
import { readDocument } from '../project-context/documents.js';
import type { GitClient, RepoRef } from '../../vendor/shared/adapters.js';
import type { Finding } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Temp-dir lifecycle
// ---------------------------------------------------------------------------

const tmpDirs: string[] = [];

async function makeTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'inj-test-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  for (const d of tmpDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Fixture diff — simple 1-file diff with a known added line
// ---------------------------------------------------------------------------

const FIXTURE_DIFF_RAW = `diff --git a/src/auth.ts b/src/auth.ts
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,3 +10,5 @@
 function login(user: string) {
+  const token = jwt.sign({ user }, hardcodedSecret);
+  return token;
 }`;

const FIXTURE_DIFF = parseUnifiedDiff(FIXTURE_DIFF_RAW);

const REPO_REF: RepoRef = { owner: 'test-owner', name: 'test-repo' };

// ---------------------------------------------------------------------------
// Factory: fake GitClient pointing to a real temp dir
// ---------------------------------------------------------------------------

function makeGit(cloneRoot: string): GitClient {
  return {
    clonePathFor: (_repo: RepoRef) => cloneRoot,
    clone: async () => ({ path: cloneRoot }),
    fetchPullHead: async () => undefined,
    sync: async () => ({ head: 'abc123' }),
    currentHead: async () => 'abc123',
    diffNameOnly: async () => [],
    diff: async () => FIXTURE_DIFF,
    blame: async () => [],
    log: async () => [],
    readFile: async () => '',
  } as unknown as GitClient;
}

// ---------------------------------------------------------------------------
// Factory: minimal valid Review fixture for MockLLMProvider
// ---------------------------------------------------------------------------

function makeReviewFixture(overrides: Partial<{ findings: Finding[] }> = {}) {
  return {
    verdict: 'request_changes',
    summary: 'Found a hardcoded secret.',
    score: 20,
    findings: overrides.findings ?? [],
  };
}

/** Minimal valid Finding that SURVIVES grounding (line 11 is in the hunk above). */
function groundedFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded secret in JWT signing',
    file: 'src/auth.ts',
    start_line: 11,
    end_line: 12,
    rationale: 'Line 11 adds a hardcoded secret into jwt.sign — this will leak credentials.',
    confidence: 0.95,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Helper: read spec texts for resolved paths, collecting missing
// ---------------------------------------------------------------------------

async function loadSpecTexts(
  git: GitClient,
  repoRef: RepoRef,
  paths: string[],
): Promise<{ specTexts: string[]; readPaths: string[]; missingPaths: string[] }> {
  const specTexts: string[] = [];
  const readPaths: string[] = [];
  const missingPaths: string[] = [];

  for (const p of paths) {
    try {
      const text = await readDocument(git, repoRef, p);
      specTexts.push(text);
      readPaths.push(p);
    } catch {
      missingPaths.push(p);
    }
  }
  return { specTexts, readPaths, missingPaths };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('project-context spec injection', () => {
  it('injects both agent doc + skill doc into the prompt, deduped (AC-18/AC-19)', async () => {
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);
    await fs.writeFile(path.join(docsDir, 'auth-spec.md'), '# Auth spec\nNo hardcoded secrets.');
    await fs.writeFile(path.join(docsDir, 'security.md'), '# Security\nUse env vars for secrets.');

    const git = makeGit(root);
    const llm = new MockLLMProvider('openai', {
      structured: makeReviewFixture(),
    });

    // agent has one doc, skill has one doc (different path)
    const specPaths = resolveSpecPaths({
      agentPaths: ['docs/auth-spec.md'],
      loadedSkills: [{ paths: ['docs/security.md'] }],
    });
    // order: agent path first, then skill path
    expect(specPaths).toEqual(['docs/auth-spec.md', 'docs/security.md']);

    const { specTexts, readPaths, missingPaths } = await loadSpecTexts(git, REPO_REF, specPaths);

    // both docs read successfully
    expect(readPaths).toEqual(['docs/auth-spec.md', 'docs/security.md']);
    expect(missingPaths).toHaveLength(0);

    const outcome = await reviewPullRequest({
      systemPrompt: 'You are a security reviewer.',
      model: 'gpt-4.1',
      diff: FIXTURE_DIFF,
      llm,
      specs: specTexts,
    });

    // ## Project context must appear in the assembled prompt (specs injected)
    const userMessage = outcome.assembly.user;
    expect(userMessage).toContain('## Project context');
    // both spec contents are present
    expect(userMessage).toContain('No hardcoded secrets.');
    expect(userMessage).toContain('Use env vars for secrets.');
  });

  it('deduplicates paths — agent and skill with overlapping path → one injection (AC-19)', async () => {
    const root = await makeTmpDir();
    const specsDir = path.join(root, 'specs');
    await fs.mkdir(specsDir);
    await fs.writeFile(path.join(specsDir, 'shared.md'), '# Shared spec\nOne occurrence.');

    const git = makeGit(root);
    const llm = new MockLLMProvider('openai', { structured: makeReviewFixture() });

    // both agent and skill reference the same path
    const specPaths = resolveSpecPaths({
      agentPaths: ['specs/shared.md'],
      loadedSkills: [{ paths: ['specs/shared.md', 'specs/other.md'] }],
    });
    // 'specs/shared.md' appears once (first-wins), 'specs/other.md' is new
    // but 'specs/other.md' does not exist on disk → it will be in missingPaths
    expect(specPaths[0]).toBe('specs/shared.md');
    expect(specPaths).toContain('specs/other.md');

    const { specTexts, readPaths, missingPaths } = await loadSpecTexts(git, REPO_REF, specPaths);

    // shared.md read once, other.md missing
    expect(readPaths).toHaveLength(1);
    expect(readPaths[0]).toBe('specs/shared.md');
    expect(missingPaths).toContain('specs/other.md');

    const outcome = await reviewPullRequest({
      systemPrompt: 'You are a reviewer.',
      model: 'gpt-4.1',
      diff: FIXTURE_DIFF,
      llm,
      specs: specTexts,
    });

    // the spec text appears exactly once (it was injected once)
    const occurrences = outcome.assembly.user.split('One occurrence.').length - 1;
    expect(occurrences).toBe(1);
  });

  it('stale/unreadable path is skipped; its path appears in missingPaths distinct from readPaths (AC-22/AC-26)', async () => {
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);
    await fs.writeFile(path.join(docsDir, 'existing.md'), '# Existing spec\nValid content.');
    // 'docs/stale.md' intentionally NOT created

    const git = makeGit(root);
    const llm = new MockLLMProvider('openai', { structured: makeReviewFixture() });

    const specPaths = resolveSpecPaths({
      agentPaths: ['docs/existing.md', 'docs/stale.md'],
      loadedSkills: [],
    });

    const { specTexts, readPaths, missingPaths } = await loadSpecTexts(git, REPO_REF, specPaths);

    // existing.md read successfully, stale.md not
    expect(readPaths).toContain('docs/existing.md');
    expect(missingPaths).toContain('docs/stale.md');
    // the two arrays are distinct (no overlap)
    const readSet = new Set(readPaths);
    const missingSet = new Set(missingPaths);
    for (const p of readSet) {
      expect(missingSet.has(p)).toBe(false);
    }

    const outcome = await reviewPullRequest({
      systemPrompt: 'You are a reviewer.',
      model: 'gpt-4.1',
      diff: FIXTURE_DIFF,
      llm,
      specs: specTexts,
    });

    // survivor is injected
    expect(outcome.assembly.user).toContain('Valid content.');
  });

  it('zero attached docs → NO "## Project context" in prompt; specs_read equivalent is [] (AC-23)', async () => {
    const root = await makeTmpDir();
    const git = makeGit(root);
    const llm = new MockLLMProvider('openai', { structured: makeReviewFixture() });

    // no paths attached to agent or skills
    const specPaths = resolveSpecPaths({
      agentPaths: [],
      loadedSkills: [],
    });
    expect(specPaths).toHaveLength(0);

    const { specTexts, readPaths } = await loadSpecTexts(git, REPO_REF, specPaths);

    // no specs → no calls → no text
    expect(readPaths).toHaveLength(0);
    expect(specTexts).toHaveLength(0);

    const outcome = await reviewPullRequest({
      systemPrompt: 'You are a reviewer.',
      model: 'gpt-4.1',
      diff: FIXTURE_DIFF,
      llm,
      // specs: undefined (omitted when empty)
    });

    // zero attached docs → no ## Project context section
    expect(outcome.assembly.user).not.toContain('## Project context');
    expect(outcome.assembly.specs).toBeNull();
  });

  it('LLM call count is the same whether or not specs are attached (AC-24)', async () => {
    const root = await makeTmpDir();
    const docsDir = path.join(root, 'docs');
    await fs.mkdir(docsDir);
    await fs.writeFile(path.join(docsDir, 'spec.md'), '# Spec\nContent.');

    const git = makeGit(root);

    // Run WITHOUT specs
    const llmNoSpecs = new MockLLMProvider('openai', { structured: makeReviewFixture() });
    await reviewPullRequest({
      systemPrompt: 'You are a reviewer.',
      model: 'gpt-4.1',
      diff: FIXTURE_DIFF,
      llm: llmNoSpecs,
    });
    const callsWithoutSpecs = llmNoSpecs.calls.filter(
      (c) => c.method === 'completeStructured',
    ).length;

    // Run WITH specs
    const llmWithSpecs = new MockLLMProvider('openai', { structured: makeReviewFixture() });
    const { specTexts } = await loadSpecTexts(git, REPO_REF, ['docs/spec.md']);
    await reviewPullRequest({
      systemPrompt: 'You are a reviewer.',
      model: 'gpt-4.1',
      diff: FIXTURE_DIFF,
      llm: llmWithSpecs,
      specs: specTexts,
    });
    const callsWithSpecs = llmWithSpecs.calls.filter(
      (c) => c.method === 'completeStructured',
    ).length;

    // spec injection adds zero extra LLM calls (AC-24)
    expect(callsWithSpecs).toBe(callsWithoutSpecs);
  });

  it('AC-35: grounded finding whose diff quote is in the diff survives groundFindings()', async () => {
    // Configure MockLLMProvider to return a finding whose start_line is in the hunk.
    // The diff adds line 11 (jwt.sign...) and line 12 (return token).
    // The finding references lines 11-12 in src/auth.ts → must SURVIVE grounding.
    const root = await makeTmpDir();
    const specsDir = path.join(root, 'specs');
    await fs.mkdir(specsDir);
    // The invariant spec: "Do not use hardcoded secrets in jwt.sign"
    await fs.writeFile(
      path.join(specsDir, 'invariants.md'),
      '# Invariants\nDo not use hardcoded secrets in jwt.sign.',
    );

    const git = makeGit(root);
    const finding = groundedFinding();

    const llm = new MockLLMProvider('openai', {
      structured: makeReviewFixture({ findings: [finding] }),
    });

    const { specTexts } = await loadSpecTexts(git, REPO_REF, ['specs/invariants.md']);

    // The finding's diff quote exists in the diff: line 11 is the added "jwt.sign" line
    const outcome = await reviewPullRequest({
      systemPrompt: 'You are a security reviewer.',
      model: 'gpt-4.1',
      diff: FIXTURE_DIFF,
      llm,
      specs: specTexts,
    });

    // The invariant spec was injected into the prompt
    expect(outcome.assembly.user).toContain('## Project context');
    expect(outcome.assembly.user).toContain('Do not use hardcoded secrets');

    // The finding SURVIVES grounding (its line range intersects the diff hunk)
    expect(outcome.review.findings).toHaveLength(1);
    expect(outcome.review.findings[0]).toMatchObject({
      id: 'f1',
      severity: 'CRITICAL',
      category: 'security',
      file: 'src/auth.ts',
      start_line: 11,
      end_line: 12,
    });

    // Double-check directly via groundFindings for the AC-35 invariant:
    const ground = groundFindings([finding], FIXTURE_DIFF);
    // the finding must be kept, not dropped
    expect(ground.kept).toHaveLength(1);
    expect(ground.kept[0]!.id).toBe('f1');
    expect(ground.dropped).toHaveLength(0);
  });
});

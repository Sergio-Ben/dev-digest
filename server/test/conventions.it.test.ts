import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { ContainerOverrides } from '../src/platform/container.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

const USERS_TS = [
  'import { db } from "./db";',
  '',
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  if (!user) throw new NotFoundError("User not found");',
  '  return user;',
  '}',
].join('\n');

const FILES: Record<string, string> = {
  'package.json': '{ "name": "payments-api", "type": "module" }',
  'src/api/users.ts': USERS_TS,
};

/**
 * The model's answer: two well-evidenced candidates, one whose snippet is
 * FABRICATED (never appears in any sampled file) and one below MIN_CONFIDENCE.
 * Only the first two may survive.
 */
const EXTRACTION = {
  candidates: [
    {
      category: 'Async/Await Then Chains',
      rule: 'Always use async/await instead of .then() chains.',
      evidence_path: 'src/api/users.ts',
      evidence_snippet: '  const user = await db.users.find(id);',
      confidence: 0.92,
    },
    {
      category: 'esm-modules',
      rule: 'Declare packages as ESM with "type": "module".',
      evidence_path: 'package.json',
      evidence_snippet: '{ "name": "payments-api", "type": "module" }',
      confidence: 0.8,
    },
    {
      category: 'hallucinated',
      rule: 'Wrap every query in a retry helper.',
      evidence_path: 'src/api/users.ts',
      evidence_snippet: 'const user = await withRetry(() => db.users.find(id));',
      confidence: 0.9,
    },
    {
      category: 'low-confidence',
      rule: 'Prefer const over let.',
      evidence_path: 'src/api/users.ts',
      evidence_snippet: 'return user;',
      confidence: 0.2,
    },
  ],
};

const repoIntelStub = (paths: string[]) =>
  ({ getConventionSamples: async () => paths }) as unknown as RepoIntel;

const overrides = (paths = ['src/api/users.ts']): ContainerOverrides => ({
  git: new MockGitClient({ files: FILES }),
  repoIntel: repoIntelStub(paths),
  llm: {
    openai: new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: EXTRACTION },
    }),
  },
});

d('Conventions extractor (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'payments-api',
        fullName: 'acme/payments-api-conventions',
      })
      .returning();
    repoId = repo!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  it('extract persists only candidates whose snippet was found in a sampled file', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: overrides() });

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.candidates.map((c: { rule: string }) => c.rule).sort()).toEqual([
      'Always use async/await instead of .then() chains.',
      'Declare packages as ESM with "type": "module".',
    ]);
    // 1 fabricated snippet + 1 below MIN_CONFIDENCE.
    expect(body.scan.dropped_count).toBe(2);
    expect(body.scan.candidate_count).toBe(2);
    expect(body.scan.sample_count).toBe(2);

    // The line range comes from the REAL match, not from the model.
    const asyncRule = body.candidates.find((c: { category: string }) =>
      c.category === 'async-await-then-chains',
    );
    expect(asyncRule.evidence_start_line).toBe(4);
    expect(asyncRule.evidence_end_line).toBe(4);
    expect(asyncRule.status).toBe('pending');

    await app.close();
  });

  it('makes exactly ONE model call — file selection is pure code', async () => {
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: { ConventionExtraction: EXTRACTION },
    });
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { ...overrides(), llm: { openai: llm } },
    });

    await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` });
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);

    await app.close();
  });

  it('PATCH flips status and edits the rule; GET reflects it', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: overrides() });
    const listed = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json();
    const target = listed.candidates[0];

    const patched = await app.inject({
      method: 'PATCH',
      url: `/conventions/${target.id}`,
      payload: { status: 'accepted', rule: 'Always await database calls.' },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      status: 'accepted',
      rule: 'Always await database calls.',
    });

    const after = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json();
    expect(after.candidates.find((c: { id: string }) => c.id === target.id)).toMatchObject({
      status: 'accepted',
      rule: 'Always await database calls.',
    });

    await app.close();
  });

  it('a re-scan keeps accepted and rejected rows and does not resurrect them', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: overrides() });

    const before = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions` })
    ).json();
    const other = before.candidates.find((c: { status: string }) => c.status === 'pending');
    await app.inject({
      method: 'PATCH',
      url: `/conventions/${other.id}`,
      payload: { status: 'rejected' },
    });

    const rescan = (
      await app.inject({ method: 'POST', url: `/repos/${repoId}/conventions/extract` })
    ).json();

    const statuses = rescan.candidates.map((c: { status: string }) => c.status).sort();
    // The rejected rule is not re-added as a fresh pending duplicate — and
    // neither is the accepted one whose TEXT the previous test edited (dedupe
    // falls back to the evidence when the rule no longer matches).
    expect(statuses).toEqual(['accepted', 'rejected']);
    expect(rescan.candidates).toHaveLength(2);

    await app.close();
  });

  it('skill-draft seeds from the accepted candidates only', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: overrides() });
    const draft = (
      await app.inject({ method: 'GET', url: `/repos/${repoId}/conventions/skill-draft` })
    ).json();

    expect(draft.name).toBe('payments-api-conventions');
    expect(draft.description).toBe('1 house convention extracted from payments-api');
    expect(draft.body).toContain('Always await database calls.');
    expect(draft.evidence_files).toEqual(['src/api/users.ts']);

    await app.close();
  });

  it('POST .../conventions/skill creates the skill with evidence_files and links the agent', async () => {
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: overrides() });
    const [agent] = await pg.handle.db
      .select()
      .from(t.agents)
      .where(eq(t.agents.workspaceId, workspaceId));

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/skill`,
      payload: {
        name: 'payments-api-conventions',
        description: 'House rules',
        body: '# payments-api-conventions\n\nEdited by the user.',
        agent_id: agent!.id,
      },
    });
    expect(res.statusCode).toBe(201);
    const skill = res.json();
    expect(skill).toMatchObject({
      type: 'convention',
      source: 'extracted',
      // The server saves what the user submitted — it does NOT regenerate.
      body: '# payments-api-conventions\n\nEdited by the user.',
      evidence_files: ['src/api/users.ts'],
    });

    const links = await pg.handle.db
      .select()
      .from(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agent!.id), eq(t.agentSkills.skillId, skill.id)));
    expect(links).toHaveLength(1);

    // The source candidates are stamped with the skill they were rolled into.
    const consumed = await pg.handle.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.repoId, repoId), eq(t.conventions.skillId, skill.id)));
    expect(consumed).toHaveLength(1);

    await app.close();
  });

  it('extract on an unindexed repo with no readable files is a 4xx, not an empty scan', async () => {
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: {} }),
        repoIntel: repoIntelStub([]),
        llm: { openai: new MockLLMProvider('openai', { structuredBySchema: {} }) },
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);

    await app.close();
  });
});

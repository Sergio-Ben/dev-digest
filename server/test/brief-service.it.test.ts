import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { ContainerOverrides } from '../src/platform/container.js';
import { BriefService } from '../src/modules/brief/service.js';
import { BriefRepository } from '../src/modules/brief/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;
const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Matches @devdigest/shared `Intent` schema exactly (schemaName: 'Intent'). */
const INTENT_FIXTURE = {
  intent: 'Adds rate limiting middleware to public API endpoints.',
  in_scope: ['src/config.ts'],
  out_of_scope: [],
};

/** Matches @devdigest/shared `Brief` schema exactly (schemaName: 'Brief'). Cites a real
 *  changed file (src/config.ts) so grounding keeps both the risk and the focus entry. */
const BRIEF_FIXTURE = {
  what: 'Adds rate limiting middleware to public endpoints.',
  why: 'Prevents abuse of the public API.',
  risk_level: 'medium',
  risks: [
    {
      kind: 'security',
      title: 'Hardcoded secret introduced',
      explanation: 'A live secret is committed alongside the rate limiter config.',
      severity: 'medium',
      file_refs: ['src/config.ts'],
      endpoint_refs: [],
    },
  ],
  review_focus: [
    {
      file: 'src/config.ts',
      line: 11,
      reason: 'Hardcoded secret introduced here.',
      endpoint_ref: null,
    },
  ],
};

const NO_DATA_BLAST: RepoIntel = {
  getBlastRadius: async () => ({
    changedSymbols: [],
    callers: [],
    impactedEndpoints: [],
    degraded: true,
    degradedReason: 'index_failed',
  }),
} as unknown as RepoIntel;

const INDEXED_BLAST: RepoIntel = {
  getBlastRadius: async () => ({
    changedSymbols: [{ file: 'src/config.ts', name: 'config', kind: 'variable' }],
    callers: [],
    impactedEndpoints: ['GET /health'],
  }),
} as unknown as RepoIntel;

function llmWith(brief: unknown = BRIEF_FIXTURE, intent: unknown = INTENT_FIXTURE): MockLLMProvider {
  return new MockLLMProvider('openai', {
    structuredBySchema: { Brief: brief, Intent: intent },
  });
}

const baseOverrides = (repoIntel: RepoIntel, llm: MockLLMProvider): ContainerOverrides => ({
  git: new MockGitClient({}),
  repoIntel,
  llm: { openai: llm },
});

d('BriefService (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function setupRepoAndPr(opts: { body?: string | null; changedFiles?: boolean } = {}) {
    const name = `payments-api-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: opts.changedFiles === false ? 0 : 1,
        status: 'needs_review',
        body: opts.body ?? 'Add rate limiting. Closes #999.',
      })
      .returning();

    if (opts.changedFiles !== false) {
      await pg.handle.db.insert(t.prFiles).values({
        prId: pr!.id,
        path: 'src/config.ts',
        additions: 1,
        deletions: 0,
        patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
      });
    }
    return { repoId: repo!.id, prId: pr!.id as string };
  }

  it('a PR with a stored intent issues zero intent-model calls (AC-3)', async () => {
    const { prId } = await setupRepoAndPr();
    await pg.handle.db
      .insert(t.prIntent)
      .values({ prId, intent: INTENT_FIXTURE.intent, inScope: INTENT_FIXTURE.in_scope, outOfScope: [] });

    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });

    const result = await new BriefService(app.container).getOrCompose(workspaceId, prId);

    expect(result.brief.what).toBe(BRIEF_FIXTURE.what);
    expect(llm.calls.filter((c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Intent')).toHaveLength(0);
    expect(llm.calls.filter((c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Brief')).toHaveLength(1);

    await app.close();
  });

  it('AC-21: after composition, the pr_brief row is persisted with the brief plus its state key, provider and model', async () => {
    const { prId } = await setupRepoAndPr();
    await pg.handle.db
      .insert(t.prIntent)
      .values({ prId, intent: INTENT_FIXTURE.intent, inScope: INTENT_FIXTURE.in_scope, outOfScope: [] });

    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });

    const result = await new BriefService(app.container).getOrCompose(workspaceId, prId);

    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(row).toBeDefined();
    const stored = row!.json as {
      state_key: string;
      brief: unknown;
      provider: string;
      model: string;
    };
    expect(typeof stored.state_key).toBe('string');
    expect(stored.state_key.length).toBeGreaterThan(0);
    expect(stored.brief).toEqual(result.brief);
    expect(stored.provider).toBe(result.provider);
    expect(stored.model).toBe(result.model);

    await app.close();
  });

  it('an unindexed repo (degraded blast) still returns a complete Brief, naming blast in degraded_inputs (AC-5)', async () => {
    const { prId } = await setupRepoAndPr({ body: 'Add rate limiting.' });
    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(NO_DATA_BLAST, llm) });

    const result = await new BriefService(app.container).getOrCompose(workspaceId, prId);

    expect(result.brief.risks.length).toBeGreaterThan(0);
    expect(result.brief.review_focus.length).toBeGreaterThan(0);
    expect(result.degraded_inputs.some((d) => d.startsWith('blast_degraded:'))).toBe(true);

    await app.close();
  });

  it('a body linking a nonexistent issue still composes (AC-6)', async () => {
    // No `github` override → container.github() throws ConfigError (no PAT
    // configured in the test container) → caught → references best-effort skip it.
    const { prId } = await setupRepoAndPr({ body: 'Add rate limiting. Closes #999999.' });
    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });

    const result = await new BriefService(app.container).getOrCompose(workspaceId, prId);

    expect(result.brief.what).toBe(BRIEF_FIXTURE.what);

    await app.close();
  });

  it('a body linking a real issue resolves it and threads it into the dedicated "## Linked issue" prompt section (AC-1g)', async () => {
    const { prId } = await setupRepoAndPr({ body: 'Add rate limiting. Closes #999.' });
    const llm = llmWith();
    const github = new MockGitHubClient({});
    const app = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { ...baseOverrides(INDEXED_BLAST, llm), github },
    });

    await new BriefService(app.container).getOrCompose(workspaceId, prId);

    const briefCall = llm.calls.find(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Brief',
    );
    expect(briefCall).toBeDefined();
    const userMessage = (
      briefCall!.req as { messages: { role: string; content: string }[] }
    ).messages.find((m) => m.role === 'user')!.content;

    // MockGitHubClient#getIssue returns { title: 'Issue #999', body: 'mock issue' }
    // for any issue number — proves `composeBrief` (via `service.ts`'s new
    // best-effort issue resolution) received a POPULATED `issue` param, not
    // just that the reference was folded generically into
    // `## Referenced plans/specs`.
    expect(userMessage).toContain('## Linked issue');
    expect(userMessage).toContain('Issue #999');
    expect(userMessage).toContain('mock issue');

    await app.close();
  });

  it('a second request on an unchanged PR issues zero model calls (AC-23); recomputing intent then requesting recomposes (AC-22)', async () => {
    const { prId } = await setupRepoAndPr();
    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });
    const service = new BriefService(app.container);

    const first = await service.getOrCompose(workspaceId, prId);
    const callsAfterFirst = llm.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const second = await service.getOrCompose(workspaceId, prId);
    expect(llm.calls.length).toBe(callsAfterFirst); // zero new calls
    expect(second).toEqual(first);

    // AC-22: recomputing intent (with genuinely different content) invalidates
    // the state key → the next request recomposes. Uses a separate app/llm
    // pointed at the same db so the recompute step returns a DIFFERENT intent
    // than INTENT_FIXTURE — the state key is a pure function of intent
    // *content*, so recomputing to an identical value would not (and should
    // not) invalidate the cache.
    const differentIntent = {
      intent: 'Adds rate limiting middleware AND a new audit log.',
      in_scope: ['src/config.ts', 'src/audit.ts'],
      out_of_scope: [],
    };
    const recomputeLlm = llmWith(BRIEF_FIXTURE, differentIntent);
    const recomputeApp = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: baseOverrides(INDEXED_BLAST, recomputeLlm),
    });
    const { IntentService } = await import('../src/modules/intent/service.js');
    await new IntentService(recomputeApp.container).recompute(workspaceId, prId);

    const briefCallsBeforeThird = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Brief',
    ).length;
    const third = await service.getOrCompose(workspaceId, prId);
    const briefCallsAfterThird = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Brief',
    ).length;
    expect(briefCallsAfterThird).toBe(briefCallsBeforeThird + 1);
    expect(third).not.toEqual(first);

    await app.close();
    await recomputeApp.close();
  });

  it('force: true on an unchanged PR issues exactly one call (AC-25)', async () => {
    const { prId } = await setupRepoAndPr();
    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });
    const service = new BriefService(app.container);

    await service.getOrCompose(workspaceId, prId);
    const briefCallsBefore = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Brief',
    ).length;

    await service.compose(workspaceId, prId, { force: true });
    const briefCallsAfter = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Brief',
    ).length;
    expect(briefCallsAfter).toBe(briefCallsBefore + 1);

    await app.close();
  });

  it('two concurrent requests produce one call and two identical responses (AC-27)', async () => {
    const { prId } = await setupRepoAndPr();
    // Pre-seed intent so the intent step (outside the single-flight) does not
    // itself race into a duplicate intent-model call — isolates the assertion
    // to the brief composition's own single-flight behaviour.
    await pg.handle.db
      .insert(t.prIntent)
      .values({ prId, intent: INTENT_FIXTURE.intent, inScope: INTENT_FIXTURE.in_scope, outOfScope: [] });

    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });
    const service = new BriefService(app.container);

    const [a, b] = await Promise.all([
      service.getOrCompose(workspaceId, prId),
      service.getOrCompose(workspaceId, prId),
    ]);

    expect(a).toEqual(b);
    expect(
      llm.calls.filter((c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Brief'),
    ).toHaveLength(1);

    await app.close();
  });

  it('a forced provider error leaves the prior stored envelope byte-identical and still readable (AC-32)', async () => {
    const { prId } = await setupRepoAndPr();
    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });
    const service = new BriefService(app.container);

    await service.getOrCompose(workspaceId, prId);
    const briefRepo = new BriefRepository(pg.handle.db);
    const before = await briefRepo.getEnvelope(prId);
    expect(before).toBeDefined();

    // Fixture that fails the Brief schema (missing all required fields) forces
    // MockLLMProvider.completeStructured to throw.
    const badLlm = llmWith({ nope: true });
    const badApp = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: baseOverrides(INDEXED_BLAST, badLlm),
    });
    const badService = new BriefService(badApp.container);

    await expect(badService.compose(workspaceId, prId, { force: true })).rejects.toThrow();

    const after = await briefRepo.getEnvelope(prId);
    expect(after).toEqual(before);

    await app.close();
    await badApp.close();
  });

  it('a zero-changed-file PR makes no model call (AC-41)', async () => {
    const { prId } = await setupRepoAndPr({ changedFiles: false });
    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });

    const result = await new BriefService(app.container).getOrCompose(workspaceId, prId);

    expect(result.degraded_inputs).toContain('no_changed_files');
    expect(result.brief.risk_level).toBe('low');
    expect(result.brief.risks).toEqual([]);
    expect(llm.calls).toHaveLength(0);

    const stored = await new BriefRepository(pg.handle.db).getEnvelope(prId);
    expect(stored).toBeUndefined(); // nothing persisted

    await app.close();
  });

  it('AC-49 (one-call half): a headline-scenario fixture PR (9 changed files, stored intent, indexed repo) composes with exactly one brief-model call, and every risk/focus citation lands inside the PR\'s changed-file set', async () => {
    const name = `payments-api-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 482,
        title: 'Add rate limiting to public API endpoints',
        author: 'marisa.koch',
        branch: 'feat/rate-limit',
        base: 'main',
        headSha: 'headline482',
        additions: 40,
        deletions: 5,
        filesCount: 9,
        status: 'needs_review',
        body: 'Adds a rate limiter middleware in front of the public API.',
      })
      .returning();
    const prId = pr!.id as string;

    const changedFiles = [
      'src/middleware/rate-limit.ts',
      'src/config.ts',
      'src/routes/api/public.ts',
      'src/routes/api/health.ts',
      'src/jobs/cron.ts',
      'package.json',
      'package-lock.json',
      'test/rate-limit.test.ts',
      'docs/rate-limiting.md',
    ];
    await pg.handle.db.insert(t.prFiles).values(
      changedFiles.map((path) => ({
        prId,
        path,
        additions: 4,
        deletions: 1,
        patch: '@@ -1,2 +1,3 @@\n context\n+added line',
      })),
    );

    await pg.handle.db
      .insert(t.prIntent)
      .values({ prId, intent: INTENT_FIXTURE.intent, inScope: INTENT_FIXTURE.in_scope, outOfScope: [] });

    const headlineBrief = {
      what: 'Adds rate limiting middleware to public API endpoints.',
      why: 'Prevents abuse of unauthenticated public endpoints.',
      risk_level: 'medium',
      risks: [
        {
          kind: 'security',
          title: 'New middleware sits on the auth surface',
          explanation: 'The rate-limit middleware runs before auth checks.',
          severity: 'medium',
          file_refs: ['src/middleware/rate-limit.ts:14'],
          endpoint_refs: [],
        },
        {
          kind: 'dependency',
          title: 'New dependency introduced',
          explanation: 'package.json adds a new rate-limiting library.',
          severity: 'low',
          file_refs: ['package.json'],
          endpoint_refs: [],
        },
      ],
      review_focus: [
        {
          file: 'src/middleware/rate-limit.ts',
          line: 14,
          reason: 'Confirm the limiter runs after authentication.',
          endpoint_ref: null,
        },
        { file: 'package.json', line: null, reason: 'Check the new dependency version.', endpoint_ref: null },
      ],
    };
    const llm = llmWith(headlineBrief);
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });

    const result = await new BriefService(app.container).getOrCompose(workspaceId, prId);

    const briefCalls = llm.calls.filter(
      (c) => c.method === 'completeStructured' && (c.req as { schemaName: string }).schemaName === 'Brief',
    );
    expect(briefCalls).toHaveLength(1);

    const changedFileSet = new Set(changedFiles);
    for (const risk of result.brief.risks) {
      for (const ref of risk.file_refs) {
        const path = ref.includes(':') ? ref.slice(0, ref.lastIndexOf(':')) : ref;
        expect(changedFileSet.has(path)).toBe(true);
      }
    }
    for (const focus of result.brief.review_focus) {
      expect(changedFileSet.has(focus.file)).toBe(true);
    }
    expect(result.brief.risks.length).toBeGreaterThan(0);
    expect(result.brief.review_focus.length).toBeGreaterThan(0);

    await app.close();
  });

  it('a missing PR is a NotFoundError (AC-31)', async () => {
    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });

    await expect(
      new BriefService(app.container).getOrCompose(workspaceId, '00000000-0000-0000-0000-000000000000'),
    ).rejects.toThrow(/not found/i);

    await app.close();
  });

  it('a PR id from another workspace 404s at the /pulls/:id/brief routes (AC-31 cross-workspace)', async () => {
    // A PR that lives in a DIFFERENT workspace than the request context
    // (buildApp with no auth override always resolves to the seeded default
    // workspace — see src/adapters/auth/local.ts). Mirrors the cross-workspace
    // 404 pattern in agents-versions.it.test.ts.
    const [otherWs] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-brief' }).returning();
    const name = `payments-api-${repoSeq++}`;
    const [foreignRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: otherWs!.id, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [foreignPr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId: foreignRepo!.id,
        number: 483,
        title: 'Foreign PR',
        author: 'someone.else',
        branch: 'feat/foreign',
        base: 'main',
        headSha: 'deadbeef01',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'A PR that belongs to a different workspace.',
      })
      .returning();
    const foreignPrId = foreignPr!.id as string;

    const llm = llmWith();
    const app = await buildApp({ config: config(), db: pg.handle.db, overrides: baseOverrides(INDEXED_BLAST, llm) });

    const getRes = await app.inject({ method: 'GET', url: `/pulls/${foreignPrId}/brief` });
    expect(getRes.statusCode).toBe(404);
    // Proves the mechanism is the workspace-scoped lookup, not "PR doesn't
    // exist" — the PR genuinely exists, just under another workspace_id.
    expect(await pg.handle.db.select().from(t.pullRequests).where(eq(t.pullRequests.id, foreignPrId))).toHaveLength(1);

    const postRes = await app.inject({ method: 'POST', url: `/pulls/${foreignPrId}/brief`, payload: {} });
    expect(postRes.statusCode).toBe(404);

    await app.close();
  });
});

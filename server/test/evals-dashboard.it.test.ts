import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { inArray } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import { EvalsRepository } from '../src/modules/evals/repository.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-dashboard] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------
// One shared fixture "flavour": a case that always fully passes (recall=1,
// precision=1) against the mocked LLM. Simple + deterministic — the tests in
// this file exercise dashboard/history/compare/cross-agent AGGREGATION, not
// the scorer itself (that's T3's `score.test.ts`) or engine execution (T6's
// `evals-run.it.test.ts`), so every case here shares one diff/expected pair.
// ---------------------------------------------------------------------------

const PASS_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,2 +10,3 @@
   const before = 1;
+  const added = 2;
   const after = 3;`;

const PASS_EXPECTED = [
  {
    severity: 'WARNING',
    category: 'bug',
    title: 'Something',
    file: 'src/foo.ts',
    start_line: 11,
    end_line: 11,
  },
];

const PASS_REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'pass',
  score: 80,
  findings: [
    {
      id: 'f-pass',
      severity: 'WARNING',
      category: 'bug',
      title: 'Something',
      file: 'src/foo.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'looks off',
      confidence: 0.8,
      kind: 'finding',
    },
  ],
};

d('Eval dashboard / history / compare / cross-agent / run-all (T7)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let evalsRepo: EvalsRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    evalsRepo = new EvalsRepository(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        llm: { openai: new MockLLMProvider('openai', { structured: PASS_REVIEW_FIXTURE }) },
      },
    });
  }

  async function createAgent(
    app: Awaited<ReturnType<typeof buildApp>>,
    name: string,
    systemPrompt = 'You are a reviewer.',
  ) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: systemPrompt },
    });
    return res.json();
  }

  async function insertCases(
    ownerId: string,
    rows: { name: string; inputDiff: string; expectedOutput: unknown }[],
  ) {
    return pg.handle.db
      .insert(t.evalCases)
      .values(
        rows.map((r) => ({
          workspaceId,
          ownerKind: 'agent' as const,
          ownerId,
          name: r.name,
          inputDiff: r.inputDiff,
          expectedOutput: r.expectedOutput as object,
        })),
      )
      .returning();
  }

  async function runBatchOnce(app: Awaited<ReturnType<typeof buildApp>>, agentId: string) {
    const res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  it(
    'per-agent dashboard: 5 batches → 5 EvalBatchRow history rows + a 3-series trend (AC-30, AC-31)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'HistoryAgent');
      await insertCases(agent.id, [{ name: 'c1', inputDiff: PASS_DIFF, expectedOutput: PASS_EXPECTED }]);

      for (let i = 0; i < 5; i++) {
        await runBatchOnce(app, agent.id);
      }

      const res = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-dashboard` });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // AC-31 — one EvalBatchRow per batch.
      expect(body.batches).toHaveLength(5);
      for (const row of body.batches) {
        expect(row.agent_id).toBe(agent.id);
        expect(typeof row.batch_id).toBe('string');
      }

      // AC-31 — the trend carries all three metric series, one point per batch.
      expect(body.trend).toHaveLength(5);
      for (const point of body.trend) {
        expect(typeof point.recall).toBe('number');
        expect(typeof point.precision).toBe('number');
        expect(typeof point.citation_accuracy).toBe('number');
      }

      // AC-30 — current metrics + delta vs the previous batch are present.
      expect(body.current).toMatchObject({ recall: 1, precision: 1, citation_accuracy: 1 });
      expect(body.delta).toMatchObject({ recall: 0, precision: 0, citation_accuracy: 0 });
      expect(body.cases_total).toBe(1);
      expect(body.recent_runs.length).toBeGreaterThan(0);
      expect(body.owner_kind).toBe('agent');
      expect(body.owner_id).toBe(agent.id);

      await app.close();
    },
  );

  it(
    'compares two batches across a prompt edit: metric deltas + added/removed prompt lines (AC-32, AC-33)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'CompareAgent', 'You are a reviewer.\nBe strict.');
      await insertCases(agent.id, [{ name: 'c1', inputDiff: PASS_DIFF, expectedOutput: PASS_EXPECTED }]);

      await runBatchOnce(app, agent.id);

      const updateRes = await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'You are a reviewer.\nBe lenient.\nAlways cite line numbers.' },
      });
      expect(updateRes.statusCode).toBe(200);

      await runBatchOnce(app, agent.id);

      const batches = await evalsRepo.listBatches(agent.id); // newest first
      expect(batches).toHaveLength(2);
      const newerId = batches[0]!.batchId;
      const olderId = batches[1]!.batchId;

      const compareRes = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-compare?a=${olderId}&b=${newerId}`,
      });
      expect(compareRes.statusCode).toBe(200);
      const body = compareRes.json();

      // AC-32 — deltas are computed older→newer regardless of query param order.
      expect(body.older.batch_id).toBe(olderId);
      expect(body.newer.batch_id).toBe(newerId);
      expect(body.deltas).toMatchObject({
        recall: expect.any(Number),
        precision: expect.any(Number),
        citation_accuracy: expect.any(Number),
      });

      // AC-33 — prompt diff from the two agent_versions snapshots.
      expect(body.prompt_diff).not.toBeNull();
      expect(body.prompt_diff.added).toEqual(
        expect.arrayContaining(['Be lenient.', 'Always cite line numbers.']),
      );
      expect(body.prompt_diff.removed).toEqual(expect.arrayContaining(['Be strict.']));

      // Same case-set size both times — no trace-count notice here.
      expect(body.trace_count_notice).toBeNull();

      await app.close();
    },
  );

  it(
    'compare with a missing version snapshot → prompt diff unavailable, deltas still present (AC-34)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'SnapshotlessAgent', 'v1 prompt');
      await insertCases(agent.id, [{ name: 'c1', inputDiff: PASS_DIFF, expectedOutput: PASS_EXPECTED }]);

      await runBatchOnce(app, agent.id);
      const versionAfterFirstRun = (await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json()
        .version as number;

      await app.inject({
        method: 'PUT',
        url: `/agents/${agent.id}`,
        payload: { system_prompt: 'v2 prompt' },
      });
      await runBatchOnce(app, agent.id);

      // Simulate a version whose config_json snapshot was never recorded /
      // no longer exists (the batch itself still records the version number
      // on its runs — only the `agent_versions` snapshot row is gone).
      await pg.handle.db
        .delete(t.agentVersions)
        .where(inArray(t.agentVersions.version, [versionAfterFirstRun]));

      const batches = await evalsRepo.listBatches(agent.id);
      expect(batches).toHaveLength(2);
      const newerId = batches[0]!.batchId;
      const olderId = batches[1]!.batchId;

      const compareRes = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-compare?a=${olderId}&b=${newerId}`,
      });
      expect(compareRes.statusCode).toBe(200);
      const body = compareRes.json();

      expect(body.prompt_diff).toBeNull();
      expect(body.deltas).toMatchObject({
        recall: expect.any(Number),
        precision: expect.any(Number),
        citation_accuracy: expect.any(Number),
      });

      await app.close();
    },
  );

  it(
    'mismatched case-set sizes across batches → "trace counts differ" notice (AC-35)',
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'TraceCountAgent');
      await insertCases(
        agent.id,
        Array.from({ length: 18 }, (_, i) => ({
          name: `case-${i}`,
          inputDiff: PASS_DIFF,
          expectedOutput: PASS_EXPECTED,
        })),
      );

      await runBatchOnce(app, agent.id); // batch 1: 18 cases

      // Grow the case set (NOT shrink it) — deleting a case cascade-deletes
      // its `eval_runs` rows (FK `onDelete: 'cascade'`), which would silently
      // shrink batch 1's own historical trace count too.
      await insertCases(
        agent.id,
        Array.from({ length: 2 }, (_, i) => ({
          name: `extra-case-${i}`,
          inputDiff: PASS_DIFF,
          expectedOutput: PASS_EXPECTED,
        })),
      );

      await runBatchOnce(app, agent.id); // batch 2: 20 cases

      const batches = await evalsRepo.listBatches(agent.id);
      expect(batches).toHaveLength(2);
      const newerId = batches[0]!.batchId; // 20 cases
      const olderId = batches[1]!.batchId; // 18 cases

      const compareRes = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-compare?a=${olderId}&b=${newerId}`,
      });
      expect(compareRes.statusCode).toBe(200);
      const body = compareRes.json();

      expect(body.older.traces_total).toBe(18);
      expect(body.newer.traces_total).toBe(20);
      expect(body.trace_count_notice).toContain('20');
      expect(body.trace_count_notice).toContain('18');

      await app.close();
    },
  );

  it(
    'cross-agent dashboard lists every agent once; a never-run agent shows the empty state (AC-36, AC-38)',
    async () => {
      const app = await makeApp();
      const ranAgent = await createAgent(app, 'CrossDashRanAgent');
      await insertCases(ranAgent.id, [{ name: 'c1', inputDiff: PASS_DIFF, expectedOutput: PASS_EXPECTED }]);
      await runBatchOnce(app, ranAgent.id);

      const neverRunAgent = await createAgent(app, 'CrossDashNeverRunAgent');

      const res = await app.inject({ method: 'GET', url: '/eval/dashboard' });
      expect(res.statusCode).toBe(200);
      const body = res.json();

      // AC-36 — each agent appears exactly once.
      const agentIds = body.agents.map((a: { agent_id: string }) => a.agent_id);
      expect(new Set(agentIds).size).toBe(agentIds.length);
      expect(agentIds).toContain(ranAgent.id);
      expect(agentIds).toContain(neverRunAgent.id);

      const ranSummary = body.agents.find((a: { agent_id: string }) => a.agent_id === ranAgent.id);
      expect(ranSummary.latest).not.toBeNull();
      expect(ranSummary.latest.agent_id).toBe(ranAgent.id);

      // AC-38 — never-evaluated agent shows the empty state.
      const neverRunSummary = body.agents.find(
        (a: { agent_id: string }) => a.agent_id === neverRunAgent.id,
      );
      expect(neverRunSummary.latest).toBeNull();
      expect(neverRunSummary.trend).toEqual([]);

      await app.close();
    },
  );

  it('run-all runs every eligible agent and skips caseless ones (AC-39)', async () => {
    const app = await makeApp();
    const eligibleAgent = await createAgent(app, 'RunAllEligibleAgent');
    await insertCases(eligibleAgent.id, [
      { name: 'c1', inputDiff: PASS_DIFF, expectedOutput: PASS_EXPECTED },
    ]);
    const caselessAgent = await createAgent(app, 'RunAllCaselessAgent');

    const res = await app.inject({ method: 'POST', url: '/eval/run-all' });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { agent_id: string }[];

    expect(rows.some((r) => r.agent_id === eligibleAgent.id)).toBe(true);
    expect(rows.some((r) => r.agent_id === caselessAgent.id)).toBe(false);

    const eligibleBatches = await evalsRepo.listBatches(eligibleAgent.id);
    expect(eligibleBatches.length).toBeGreaterThan(0);
    const caselessBatches = await evalsRepo.listBatches(caselessAgent.id);
    expect(caselessBatches).toHaveLength(0);

    await app.close();
  });

  it('POST /eval/run-all is rate-limited (AC-43)', async () => {
    // The global @fastify/rate-limit plugin is deliberately NOT registered
    // when NODE_ENV=test (see server/src/app.ts) so integration suites can
    // hammer routes via inject(). To exercise the real per-route
    // `config.rateLimit` on this LLM-invoking route, build this one app with
    // NODE_ENV=production instead — the only other nodeEnv-gated behaviour is
    // pretty-printing logs (irrelevant here; LOG_LEVEL=silent keeps it quiet).
    const prodConfig = loadConfig({
      ...process.env,
      NODE_ENV: 'production',
      LOG_LEVEL: 'silent',
    } as NodeJS.ProcessEnv);
    const app = await buildApp({
      config: prodConfig,
      db: pg.handle.db,
      overrides: {
        llm: { openai: new MockLLMProvider('openai', { structured: PASS_REVIEW_FIXTURE }) },
      },
    });

    // route config: { max: 2, timeWindow: '5 minutes' }
    const first = await app.inject({ method: 'POST', url: '/eval/run-all' });
    expect(first.statusCode).toBe(200);
    const second = await app.inject({ method: 'POST', url: '/eval/run-all' });
    expect(second.statusCode).toBe(200);
    const third = await app.inject({ method: 'POST', url: '/eval/run-all' });
    expect(third.statusCode).toBe(429);

    await app.close();
  });
});

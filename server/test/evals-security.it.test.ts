import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type {
  ChatMessage,
  LLMProvider,
  ModelInfo,
  CompletionRequest,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
  Review,
} from '@devdigest/shared';

/**
 * T15 — cross-cutting hardening/verification pass (AC-40, AC-41, AC-43).
 *
 * This file deliberately covers only the GAPS left by the feature tasks'
 * own `*.it.test.ts` files, not everything those ACs touch:
 *  - AC-40 is already asserted for capture (`evals-capture.it.test.ts`) and
 *    cases CRUD (`evals-cases.it.test.ts`) — this file adds the missing
 *    endpoints: the single-agent batch run, the per-agent dashboard, and
 *    the compare endpoint (all live in `run.routes.ts`/`dashboard.routes.ts`,
 *    T6/T7, which never wrote a cross-workspace assertion of their own).
 *  - AC-41 (frozen input wrapped untrusted) is exercised indirectly in
 *    `evals-run.it.test.ts` (no enrichment sections leak into the prompt)
 *    but never asserts the diff is actually delimiter-wrapped — added here.
 *  - AC-42 (injection case never cites an out-of-diff file) is ALREADY
 *    fully covered by `evals-run.it.test.ts`'s grounding-case assertions —
 *    intentionally NOT duplicated here.
 *  - AC-43 rate-limiting is asserted for `POST /eval/run-all` in
 *    `evals-dashboard.it.test.ts`; the single-agent `POST
 *    /agents/:id/eval-runs` route (a separate, tighter rate limit) had no
 *    coverage — added here, plus a first assertion that run-all's
 *    concurrency bound actually holds under many eligible agents (not just
 *    that it eventually 429s).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-security] Docker not available — skipping integration tests.');
}

const testConfig = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
// Rate-limit middleware is disabled under NODE_ENV=test (server/src/app.ts) so
// integration suites can hammer routes via inject() — to actually observe a
// 429 from a route's per-route `config.rateLimit`, build that one app with
// NODE_ENV=production instead (server/INSIGHTS.md, 2026-08-27).
const prodConfig = () =>
  loadConfig({ ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

const DIFF = `diff --git a/src/foo.ts b/src/foo.ts
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -10,2 +10,3 @@
   const before = 1;
+  const added = 2;
   const after = 3;`;

const EXPECTED_OUTPUT = [
  {
    severity: 'WARNING',
    category: 'bug',
    title: 'Something',
    file: 'src/foo.ts',
    start_line: 11,
    end_line: 11,
  },
];

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'security-test fixture',
  score: 80,
  findings: [
    {
      id: 'f-security',
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

/** Records every completeStructured() call's messages, for AC-41's wrap check. */
class PromptCapturingLLMProvider implements LLMProvider {
  readonly id: 'openai' = 'openai';
  public calls: StructuredRequest<unknown>[] = [];

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('complete() not used by the review engine');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    return {
      data: REVIEW_FIXTURE as unknown as T,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(REVIEW_FIXTURE),
      attempts: 1,
    };
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error('embed() not used by the review engine');
  }
}

/** Tracks the max number of concurrently in-flight completeStructured()
 *  calls, for AC-43's run-all concurrency bound. An artificial delay is
 *  required so overlapping calls actually overlap in wall-clock time. */
class ConcurrencyTrackingLLMProvider implements LLMProvider {
  readonly id: 'openai' = 'openai';
  private inFlight = 0;
  public maxConcurrent = 0;

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }

  async complete(_req: CompletionRequest): Promise<CompletionResult> {
    throw new Error('complete() not used by the review engine');
  }

  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.inFlight++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 30));
    this.inFlight--;
    return {
      data: REVIEW_FIXTURE as unknown as T,
      model: req.model,
      tokensIn: 100,
      tokensOut: 50,
      costUsd: 0.001,
      raw: JSON.stringify(REVIEW_FIXTURE),
      attempts: 1,
    };
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error('embed() not used by the review engine');
  }
}

d('Eval endpoints — cross-cutting hardening (T15: AC-40/41/43 gaps)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(config = testConfig(), llm: LLMProvider = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE })) {
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { llm: { openai: llm } },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof buildApp>>, name: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'You are a reviewer.' },
    });
    return res.json();
  }

  async function insertCase(agentId: string, ws: string = workspaceId) {
    const [row] = await pg.handle.db
      .insert(t.evalCases)
      .values({
        workspaceId: ws,
        ownerKind: 'agent' as const,
        ownerId: agentId,
        name: 'security-case',
        inputDiff: DIFF,
        expectedOutput: EXPECTED_OUTPUT as object,
      })
      .returning();
    return row!;
  }

  it(
    'a foreign-workspace agent id 404s on batch run, dashboard, and compare — not just capture/cases (AC-40)',
    async () => {
      const app = await makeApp();

      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: 'other-eval-security' })
        .returning();
      const [foreignAgent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId: otherWs!.id,
          name: 'ForeignSecurityAgent',
          provider: 'openai',
          model: 'gpt-4.1',
          systemPrompt: 'foreign',
        })
        .returning();
      await insertCase(foreignAgent!.id, otherWs!.id);

      // POST /agents/:id/eval-runs (T6 — batch run).
      expect(
        (await app.inject({ method: 'POST', url: `/agents/${foreignAgent!.id}/eval-runs` }))
          .statusCode,
      ).toBe(404);

      // GET /agents/:id/eval-dashboard (T7).
      expect(
        (await app.inject({ method: 'GET', url: `/agents/${foreignAgent!.id}/eval-dashboard` }))
          .statusCode,
      ).toBe(404);

      // GET /agents/:id/eval-compare (T7) — the agent-ownership check must
      // 404 before any batch id is even resolved, so bogus ids are fine here.
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/agents/${foreignAgent!.id}/eval-compare?a=x&b=y`,
          })
        ).statusCode,
      ).toBe(404);

      await app.close();
    },
  );

  it(
    'the assembled eval-run prompt wraps the frozen diff as untrusted data, not raw (AC-41)',
    async () => {
      const llm = new PromptCapturingLLMProvider();
      const app = await buildApp({
        config: testConfig(),
        db: pg.handle.db,
        overrides: { llm: { openai: llm } },
      });

      const agent = await createAgent(app, 'WrapCheckAgent');
      const evalCase = await insertCase(agent.id);

      const res = await app.inject({ method: 'POST', url: `/eval-cases/${evalCase.id}/run` });
      expect(res.statusCode).toBe(200);

      expect(llm.calls.length).toBeGreaterThan(0);
      const userMessage =
        llm.calls[0]!.messages.find((m: ChatMessage) => m.role === 'user')?.content ?? '';

      // AC-41 — the diff section is delimiter-wrapped as untrusted data...
      expect(userMessage).toContain('<untrusted source="diff">');
      const wrapStart = userMessage.indexOf('<untrusted source="diff">');
      const wrapEnd = userMessage.indexOf('</untrusted>', wrapStart);
      expect(wrapEnd).toBeGreaterThan(wrapStart);
      const wrappedBlock = userMessage.slice(wrapStart, wrapEnd);

      // ...and the frozen diff content actually lives INSIDE that block, not
      // pasted unwrapped elsewhere in the prompt.
      expect(wrappedBlock).toContain('const added = 2;');
      const outsideWrap = userMessage.slice(0, wrapStart) + userMessage.slice(wrapEnd);
      expect(outsideWrap).not.toContain('const added = 2;');

      await app.close();
    },
  );

  it('POST /agents/:id/eval-runs (single-agent batch run) is rate-limited (AC-43)', async () => {
    const app = await makeApp(prodConfig());
    const agent = await createAgent(app, 'RateLimitedBatchAgent');
    await insertCase(agent.id);

    // route config: { max: 5, timeWindow: '1 minute' } (run.routes.ts)
    for (let i = 0; i < 5; i++) {
      const res = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
      expect(res.statusCode).toBe(200);
    }
    const sixth = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval-runs` });
    expect(sixth.statusCode).toBe(429);

    await app.close();
  });

  it(
    'POST /eval/run-all bounds concurrent LLM calls even with many eligible agents (AC-43)',
    async () => {
      const llm = new ConcurrencyTrackingLLMProvider();
      const app = await buildApp({
        config: testConfig(),
        db: pg.handle.db,
        overrides: { llm: { openai: llm } },
      });

      const AGENT_COUNT = 8;
      for (let i = 0; i < AGENT_COUNT; i++) {
        const agent = await createAgent(app, `RunAllBoundedAgent-${i}`);
        await insertCase(agent.id);
      }

      const res = await app.inject({ method: 'POST', url: '/eval/run-all' });
      expect(res.statusCode).toBe(200);
      const rows = res.json() as unknown[];
      expect(rows.length).toBeGreaterThanOrEqual(AGENT_COUNT);

      // The service's run-all concurrency bound (`RUN_ALL_CONCURRENCY` in
      // dashboard.service.ts, currently 3 — not exported, so hardcoded here)
      // must hold no matter how many agents are eligible: a single click
      // cannot launch unbounded concurrent LLM cost (AC-43's "bounded set").
      expect(llm.maxConcurrent).toBeGreaterThan(1);
      expect(llm.maxConcurrent).toBeLessThanOrEqual(3);

      await app.close();
    },
  );
});

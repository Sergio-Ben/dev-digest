import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-cases] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A diff touching src/normal.ts line 11, and a matching expected-finding
 *  skeleton — the scripted review below produces exactly this finding, so a
 *  run against this case is a clean pass (recall=precision=1). */
const DIFF = `diff --git a/src/normal.ts b/src/normal.ts
--- a/src/normal.ts
+++ b/src/normal.ts
@@ -10,2 +10,3 @@
   const before = 1;
+  const added = 2;
   const after = 3;`;

const EXPECTED_OUTPUT = [
  {
    severity: 'WARNING',
    category: 'bug',
    title: 'Something',
    file: 'src/normal.ts',
    start_line: 11,
    end_line: 11,
  },
];

const REVIEW_FIXTURE: Review = {
  verdict: 'comment',
  summary: 'cases run fixture',
  score: 80,
  findings: [
    {
      id: 'f-normal',
      severity: 'WARNING',
      category: 'bug',
      title: 'Something',
      file: 'src/normal.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'looks off',
      confidence: 0.8,
      kind: 'finding',
    },
  ],
};

d('Eval case CRUD + single-case run (T8 — cases.routes)', () => {
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

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({}),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
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

  it(
    'round-trips a case through CRUD, rejects malformed expected_output (AC-10), runs a ' +
      'single case via the T6 executor (AC-11), lists cases with latest-run status incl. a ' +
      "never-run case's null metrics (AC-8), and 404s a cross-workspace case id (AC-40)",
    async () => {
      const app = await makeApp();
      const agent = await createAgent(app, 'CasesAgent');

      // ---- CRUD round-trip ---------------------------------------------------
      const createRes = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: {
          name: 'normal case',
          input_diff: DIFF,
          expected_output: EXPECTED_OUTPUT,
          notes: 'created by test',
        },
      });
      expect(createRes.statusCode).toBe(201);
      const created = createRes.json();
      expect(created.owner_kind).toBe('agent');
      expect(created.owner_id).toBe(agent.id);
      expect(created.name).toBe('normal case');
      expect(created.expected_output).toEqual(EXPECTED_OUTPUT);

      const getRes = await app.inject({ method: 'GET', url: `/eval-cases/${created.id}` });
      expect(getRes.statusCode).toBe(200);
      expect(getRes.json()).toMatchObject({ id: created.id, name: 'normal case' });

      const putRes = await app.inject({
        method: 'PUT',
        url: `/eval-cases/${created.id}`,
        payload: { name: 'renamed case', notes: 'updated by test' },
      });
      expect(putRes.statusCode).toBe(200);
      const updated = putRes.json();
      expect(updated.name).toBe('renamed case');
      expect(updated.notes).toBe('updated by test');
      // Untouched fields survive a partial update.
      expect(updated.expected_output).toEqual(EXPECTED_OUTPUT);

      // ---- AC-8: list shows the never-run case with null latest_run --------
      const listBeforeRun = await app.inject({
        method: 'GET',
        url: `/agents/${agent.id}/eval-cases`,
      });
      expect(listBeforeRun.statusCode).toBe(200);
      const listedBeforeRun = listBeforeRun.json();
      const listedCase = listedBeforeRun.find((c: { id: string }) => c.id === created.id);
      expect(listedCase).toBeDefined();
      expect(listedCase.latest_run).toBeNull();

      // ---- AC-10: malformed expected_output rejected on create/update ------
      const badCreateRes = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval-cases`,
        payload: { name: 'bad case', expected_output: { not: 'an array' } },
      });
      expect(badCreateRes.statusCode).toBe(422);
      const badCreateBody = badCreateRes.json();
      expect(badCreateBody.error.code).toBe('validation_error');
      expect(badCreateBody.error.details).toBeDefined();

      const badUpdateRes = await app.inject({
        method: 'PUT',
        url: `/eval-cases/${created.id}`,
        payload: { expected_output: [{ severity: 'not-a-severity' }] },
      });
      expect(badUpdateRes.statusCode).toBe(422);
      expect(badUpdateRes.json().error.code).toBe('validation_error');

      // The rejected update never touched the persisted case.
      const afterBadUpdate = await app.inject({ method: 'GET', url: `/eval-cases/${created.id}` });
      expect(afterBadUpdate.json().expected_output).toEqual(EXPECTED_OUTPUT);

      // ---- AC-11: single-case run returns EvalRunResult ----------------------
      const runRes = await app.inject({ method: 'POST', url: `/eval-cases/${created.id}/run` });
      expect(runRes.statusCode).toBe(200);
      const runBody = runRes.json();
      expect(runBody.case_id).toBe(created.id);
      expect(typeof runBody.run_id).toBe('string');
      expect(runBody.result.per_trace).toHaveLength(1);
      const trace = runBody.result.per_trace[0];
      expect(trace.pass).toBe(true);
      expect(trace.expected).toEqual(EXPECTED_OUTPUT);
      expect(trace.actual).toHaveLength(1);
      expect(trace.actual[0]).toMatchObject({ file: 'src/normal.ts', start_line: 11 });
      expect(runBody.result.recall).toBe(1);
      expect(runBody.result.precision).toBe(1);
      expect(typeof runBody.result.duration_ms).toBe('number');
      expect(runBody.result.cost_usd).not.toBeNull();

      // The run's batch_id is null (a single-case run is never part of a batch).
      const persistedRun = await pg.handle.db
        .select()
        .from(t.evalRuns)
        .where(eq(t.evalRuns.id, runBody.run_id));
      expect(persistedRun[0]!.batchId).toBeNull();
      expect(persistedRun[0]!.agentVersion).toBe(agent.version);

      // ---- AC-8 (again): list now shows the case as passed -------------------
      const listAfterRun = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval-cases` });
      const listedAfterRun = listAfterRun
        .json()
        .find((c: { id: string }) => c.id === created.id);
      expect(listedAfterRun.latest_run).not.toBeNull();
      expect(listedAfterRun.latest_run.pass).toBe(true);
      expect(listedAfterRun.latest_run.id).toBe(runBody.run_id);

      // ---- DELETE --------------------------------------------------------------
      const deleteRes = await app.inject({ method: 'DELETE', url: `/eval-cases/${created.id}` });
      expect(deleteRes.statusCode).toBe(200);
      expect(deleteRes.json()).toEqual({ ok: true });

      const getAfterDelete = await app.inject({ method: 'GET', url: `/eval-cases/${created.id}` });
      expect(getAfterDelete.statusCode).toBe(404);

      const deleteAgainRes = await app.inject({ method: 'DELETE', url: `/eval-cases/${created.id}` });
      expect(deleteAgainRes.statusCode).toBe(404);

      // ---- AC-40: a cross-workspace case id 404s on every route --------------
      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: 'other-eval-cases' })
        .returning();
      const [foreignAgent] = await pg.handle.db
        .insert(t.agents)
        .values({
          workspaceId: otherWs!.id,
          name: 'ForeignAgent',
          provider: 'openai',
          model: 'gpt-4.1',
          systemPrompt: 'foreign',
        })
        .returning();
      const [foreignCase] = await pg.handle.db
        .insert(t.evalCases)
        .values({
          workspaceId: otherWs!.id,
          ownerKind: 'agent',
          ownerId: foreignAgent!.id,
          name: 'foreign case',
          inputDiff: DIFF,
          expectedOutput: EXPECTED_OUTPUT as object,
        })
        .returning();

      expect((await app.inject({ method: 'GET', url: `/eval-cases/${foreignCase!.id}` })).statusCode).toBe(
        404,
      );
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/eval-cases/${foreignCase!.id}`,
            payload: { name: 'hijacked' },
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'DELETE', url: `/eval-cases/${foreignCase!.id}` })).statusCode,
      ).toBe(404);
      expect(
        (await app.inject({ method: 'POST', url: `/eval-cases/${foreignCase!.id}/run` })).statusCode,
      ).toBe(404);
      // Listing/creating under the foreign agent id also 404s (agent ownership
      // check, not just the case's own workspace_id column).
      expect(
        (await app.inject({ method: 'GET', url: `/agents/${foreignAgent!.id}/eval-cases` })).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/agents/${foreignAgent!.id}/eval-cases`,
            payload: { name: 'sneaky', expected_output: [] },
          })
        ).statusCode,
      ).toBe(404);

      await app.close();
    },
  );
});

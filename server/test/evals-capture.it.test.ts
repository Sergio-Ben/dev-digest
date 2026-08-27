import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { parseUnifiedDiff } from '../src/adapters/git/diff-parser.js';
import { EvalsRepository } from '../src/modules/evals/repository.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-capture] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff touching src/config.ts, lines 10-14 (new side), so the
 * fixture review can ground findings at lines 11, 12, and 13.
 */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,5 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
+  secondFlag: true,
+  thirdFlag: true,
   redisUrl: x,`;

/** Three findings: one to accept, one to dismiss, one left undecided. */
const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Capture-eval-case fixture.',
  score: 40,
  findings: [
    {
      id: 'f-accept',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 12,
      end_line: 12,
      rationale: 'A live Stripe key is committed in source.',
      confidence: 0.95,
      kind: 'finding',
    },
    {
      id: 'f-dismiss',
      severity: 'WARNING',
      category: 'bug',
      title: 'Possible unused flag',
      file: 'src/config.ts',
      start_line: 13,
      end_line: 13,
      rationale: 'This flag looks unused.',
      confidence: 0.6,
      kind: 'finding',
    },
    {
      id: 'f-undecided',
      severity: 'SUGGESTION',
      category: 'style',
      title: 'Naming nit',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Consider renaming.',
      confidence: 0.4,
      kind: 'finding',
    },
  ],
};

async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string, repoName: string) {
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name: repoName, fullName: `acme/${repoName}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 501,
      title: 'Capture eval case fixture PR',
      author: 'marisa.koch',
      branch: 'feat/eval-capture',
      base: 'main',
      headSha: 'deadbeef',
      additions: 3,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Fixture PR for capture eval case tests.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 3,
    deletions: 0,
    patch: '@@ -10,3 +10,5 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n+  secondFlag: true,\n+  thirdFlag: true,\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('POST /findings/:id/eval-case (T5 — capture)', () => {
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
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  it(
    'derives must_find/must_not_flag from the decision, rejects undecided findings, and ' +
      'workspace-scopes the agent (AC-1, AC-2, AC-3, AC-4, AC-40)',
    async () => {
      const app = await makeApp();
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, 'eval-capture-repo');

      const agent = (
        await app.inject({
          method: 'POST',
          url: '/agents',
          payload: { name: 'CaptureAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
        })
      ).json();

      await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
      await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
      const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
      expect(reviews).toHaveLength(1);
      // All three findings ground (lines 11-13 are all covered by the diff hunk).
      expect(reviews[0].findings).toHaveLength(3);

      const findingByTitle = (title: string) =>
        reviews[0].findings.find((f: { title: string }) => f.title === title);
      const acceptedFinding = findingByTitle('Hardcoded Stripe secret key');
      const dismissedFinding = findingByTitle('Possible unused flag');
      const undecidedFinding = findingByTitle('Naming nit');

      await app.inject({ method: 'POST', url: `/findings/${acceptedFinding.id}/accept` });
      await app.inject({ method: 'POST', url: `/findings/${dismissedFinding.id}/dismiss` });
      // undecidedFinding is left untouched (both accepted_at/dismissed_at null).

      const evalsRepo = new EvalsRepository(pg.handle.db);
      const casesBefore = await evalsRepo.listCasesForOwner(workspaceId, 'agent', agent.id);
      expect(casesBefore).toHaveLength(0);

      // ---- AC-1, AC-2: accepted finding → must_find case -------------------
      const acceptedRes = await app.inject({
        method: 'POST',
        url: `/findings/${acceptedFinding.id}/eval-case`,
      });
      expect(acceptedRes.statusCode).toBe(201);
      const acceptedBody = acceptedRes.json();
      expect(acceptedBody.created).toBe(true);
      const acceptedCase = acceptedBody.case;
      expect(acceptedCase.owner_kind).toBe('agent');
      expect(acceptedCase.owner_id).toBe(agent.id);
      expect(acceptedCase.expected_output).toHaveLength(1);
      expect(acceptedCase.expected_output[0]).toMatchObject({
        file: 'src/config.ts',
        start_line: 12,
        end_line: 12,
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded Stripe secret key',
      });

      // ---- Idempotency: re-capturing the SAME finding returns the existing
      //      case, not a duplicate (guards the "reload loses state → double-add"
      //      bug). input_meta carries the source_finding_id used to dedupe. -----
      expect(acceptedCase.input_meta).toMatchObject({ source_finding_id: acceptedFinding.id });
      const dupRes = await app.inject({
        method: 'POST',
        url: `/findings/${acceptedFinding.id}/eval-case`,
      });
      expect(dupRes.statusCode).toBe(200);
      const dupBody = dupRes.json();
      expect(dupBody.created).toBe(false);
      expect(dupBody.reason).toBe('exists');
      expect(dupBody.case.id).toBe(acceptedCase.id);
      // Still exactly one case for this agent — no duplicate row was inserted.
      const casesAfterDup = await evalsRepo.listCasesForOwner(workspaceId, 'agent', agent.id);
      expect(casesAfterDup).toHaveLength(1);

      // ---- AC-3: dismissed finding → must_not_flag case ---------------------
      const dismissedRes = await app.inject({
        method: 'POST',
        url: `/findings/${dismissedFinding.id}/eval-case`,
      });
      expect(dismissedRes.statusCode).toBe(201);
      const dismissedBody = dismissedRes.json();
      expect(dismissedBody.created).toBe(true);
      const dismissedCase = dismissedBody.case;
      expect(dismissedCase.expected_output).toEqual([]);
      expect(dismissedCase.input_meta).toMatchObject({
        expectation: 'must_not_flag',
        file: 'src/config.ts',
        start_line: 13,
        end_line: 13,
      });
      expect(dismissedCase.notes).toContain('src/config.ts:13');

      // ---- AC-4: undecided finding → no case, "decide first" prompt --------
      const undecidedRes = await app.inject({
        method: 'POST',
        url: `/findings/${undecidedFinding.id}/eval-case`,
      });
      expect(undecidedRes.statusCode).toBe(200);
      const undecidedBody = undecidedRes.json();
      expect(undecidedBody.created).toBe(false);
      expect(undecidedBody.reason).toBe('undecided');
      expect(typeof undecidedBody.message).toBe('string');

      const casesAfter = await evalsRepo.listCasesForOwner(workspaceId, 'agent', agent.id);
      // Only the accepted + dismissed captures created a row — undecided did not.
      expect(casesAfter).toHaveLength(2);

      // ---- AC-5: input_diff parses to a UnifiedDiff covering file+range ----
      const parsed = parseUnifiedDiff(acceptedCase.input_diff);
      const parsedFile = parsed.files.find((f) => f.path === 'src/config.ts');
      expect(parsedFile).toBeDefined();
      const coversLine12 = parsedFile!.hunks.some((h) => h.newLineNumbers.includes(12));
      expect(coversLine12).toBe(true);

      // ---- AC-6: deleting the source finding leaves the case unchanged -----
      await pg.handle.db.delete(t.findings).where(eq(t.findings.id, acceptedFinding.id));
      const stillThere = await evalsRepo.getCase(workspaceId, acceptedCase.id);
      expect(stillThere).toBeDefined();
      expect(stillThere!.inputDiff).toBe(acceptedCase.input_diff);
      expect(stillThere!.expectedOutput).toEqual(acceptedCase.expected_output);

      // ---- AC-40: a cross-workspace finding id returns not-found -----------
      const [otherWs] = await pg.handle.db
        .insert(t.workspaces)
        .values({ name: 'other-eval-capture' })
        .returning();
      const { pr: foreignPr } = await setupRepoAndPr(pg.handle.db, otherWs!.id, 'foreign-eval-repo');
      const [foreignReview] = await pg.handle.db
        .insert(t.reviews)
        .values({ workspaceId: otherWs!.id, prId: foreignPr.id, agentId: null, kind: 'review' })
        .returning();
      const [foreignFinding] = await pg.handle.db
        .insert(t.findings)
        .values({
          reviewId: foreignReview!.id,
          file: 'src/config.ts',
          startLine: 12,
          endLine: 12,
          severity: 'WARNING',
          category: 'bug',
          title: 'Foreign finding',
          rationale: 'x',
          confidence: 0.5,
          acceptedAt: new Date(),
        })
        .returning();
      const crossWorkspaceRes = await app.inject({
        method: 'POST',
        url: `/findings/${foreignFinding!.id}/eval-case`,
      });
      expect(crossWorkspaceRes.statusCode).toBe(404);

      const ghostRes = await app.inject({
        method: 'POST',
        url: `/findings/00000000-0000-0000-0000-000000000000/eval-case`,
      });
      expect(ghostRes.statusCode).toBe(404);

      await app.close();
    },
  );
});

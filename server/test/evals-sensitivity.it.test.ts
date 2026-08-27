import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Review } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import {
  seedEvals,
  STRIPE_LEAK_FILE,
  STRIPE_LEAK_LINE,
  STRIPE_LEAK_NOISE_LINE,
} from '../src/db/seed-evals.js';
import { MockLLMProvider, type MockLLMOptions } from '../src/adapters/mocks.js';
import { EvalsRepository } from '../src/modules/evals/repository.js';
import * as t from '../src/db/schema.js';

/**
 * T16 — AC-44 sensitivity experiment: seed the "Security Reviewer" agent with
 * a gold set (T16's `seed-evals.ts`), then run the SAME two eval cases
 * (accepted stripe-key-leak `must_find` + dismissed clean-refactor
 * `must_not_flag`) through THREE prompt versions:
 *
 *   1. baseline (current prompt)      → batch 1
 *   2. strengthened (new agent version)  → batch 2
 *   3. corrupted ("also flag unused imports") → batch 3
 *
 * and asserts the run history captures all three, compare (v1→v2) renders
 * BOTH the metric deltas and the prompt diff, and compare (v2→v3) shows
 * PRECISION DROPPING because the corrupted prompt's extra "unused import"
 * finding is counted as noise (AC-25/22 interaction).
 *
 * Deterministic, zero LLM cost (N3): a single `MockLLMProvider` instance is
 * reused for the whole app, and its fixture is swapped out (by mutating the
 * SAME `opts` object the provider was constructed with — `container.llm()`
 * returns the injected override as-is, so mutating `mockOpts.structured`
 * between batches changes what subsequent `completeStructured` calls return,
 * without rebuilding the app or the mock) once per prompt version — giving
 * three distinct, reproducible fixtures with no real network call.
 *
 * The mock returns the SAME structured Review for every `completeStructured`
 * call in a batch, regardless of which case's diff produced it — but citation
 * grounding (mandatory, `reviewer-core/src/grounding.ts`) still scopes each
 * finding to the case whose diff actually contains the cited file, so a
 * `src/config.ts`-only fixture naturally grounds against the stripe-leak case
 * and is dropped ("file not present in diff") against the clean-refactor
 * case — no per-case fixture branching needed.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[evals-sensitivity] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

// ---------------------------------------------------------------------------
// Three prompt versions.
// ---------------------------------------------------------------------------

const STRONG_PROMPT = [
  'You are a meticulous security reviewer for backend TypeScript pull requests.',
  'CRITICAL: scan every line of every changed file for hardcoded secrets, API',
  'keys, and credentials (Stripe, AWS, GitHub tokens) before checking anything',
  'else. Flag any literal secret as a CRITICAL finding citing the exact line',
  'it appears on.',
].join('\n');

const CORRUPTED_PROMPT = [
  STRONG_PROMPT,
  '',
  'Also flag every unused import in the diff as a finding, even purely',
  'stylistic ones — treat unused imports as seriously as security issues.',
].join('\n');

// ---------------------------------------------------------------------------
// Three mock LLM fixtures — one per prompt version.
// ---------------------------------------------------------------------------

const STRIPE_FINDING = {
  id: 'f-stripe',
  severity: 'CRITICAL' as const,
  category: 'security' as const,
  title: 'Hardcoded Stripe secret key in commit',
  file: STRIPE_LEAK_FILE,
  start_line: STRIPE_LEAK_LINE,
  end_line: STRIPE_LEAK_LINE,
  rationale: `Line ${STRIPE_LEAK_LINE} contains a literal sk_live_ Stripe secret key.`,
  confidence: 0.98,
  kind: 'finding' as const,
};

// Noise: a real line INSIDE the same diff hunk (so it survives citation
// grounding) that does not overlap the expected finding's range — an
// UNMATCHED produced finding, i.e. pure precision noise (AC-22).
const UNUSED_IMPORT_NOISE_FINDING = {
  id: 'f-noise-unused-import',
  severity: 'SUGGESTION' as const,
  category: 'style' as const,
  title: 'Unused import detected',
  file: STRIPE_LEAK_FILE,
  start_line: STRIPE_LEAK_NOISE_LINE,
  end_line: STRIPE_LEAK_NOISE_LINE,
  rationale: 'This import appears unused and should be removed.',
  confidence: 0.4,
  kind: 'finding' as const,
};

/** Batch 1 (baseline prompt) — misses the leak entirely. */
const BASELINE_REVIEW: Review = {
  verdict: 'approve',
  summary: 'No issues found.',
  score: 92,
  findings: [],
};

/** Batch 2 (strengthened prompt) — catches exactly the accepted finding. */
const STRONG_REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'Found a critical secret leak.',
  score: 15,
  findings: [STRIPE_FINDING],
};

/** Batch 3 (corrupted prompt) — still catches the real leak, but ALSO emits
 *  the noisy "unused import" finding the corrupted instruction asked for. */
const CORRUPTED_REVIEW: Review = {
  verdict: 'request_changes',
  summary: 'Found a critical secret leak and a style nit.',
  score: 15,
  findings: [STRIPE_FINDING, UNUSED_IMPORT_NOISE_FINDING],
};

d('AC-44 — prompt sensitivity experiment (Security Reviewer gold set)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let agentId: string;
  let evalsRepo: EvalsRepository;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    const seeded = await seedEvals(pg.handle.db, { workspaceId });
    agentId = seeded.agentId;
    evalsRepo = new EvalsRepository(pg.handle.db);
  });

  afterAll(async () => {
    await pg?.stop();
  });

  it(
    'three prompt versions produce three EvalBatchRow history rows; v1→v2 compare shows metrics moving ' +
      'AND the prompt diff; v2→v3 compare shows precision DROPPING because the corrupted prompt\'s extra ' +
      'finding is counted as noise',
    async () => {
      const mockOpts: MockLLMOptions = { structured: BASELINE_REVIEW };
      // Seeded "Security Reviewer" runs on the default 'openrouter' provider
      // (see seed.ts DEFAULT_PROVIDER) — inject the mock under that key so
      // `container.llm('openrouter')` resolves to it.
      const app = await buildApp({
        config: config(),
        db: pg.handle.db,
        overrides: { llm: { openrouter: new MockLLMProvider('openai', mockOpts) } },
      });

      // `seed.ts` creates "Security Reviewer" via a raw `db.insert(t.agents)`
      // (not `AgentsRepository.insert()`), so version 1 never got an
      // `agent_versions` snapshot the way a normal create would (see
      // server/INSIGHTS.md — the "no natural flow reaches the create-time
      // snapshot" gotcha, same root cause in reverse). Snapshot it here,
      // mirroring `AgentsRepository.snapshotVersion` exactly, so the v1→v2
      // compare below can render a real prompt diff instead of falling back
      // to the AC-34 "missing snapshot" path.
      const [agentRow] = await pg.handle.db.select().from(t.agents).where(eq(t.agents.id, agentId));
      const linkedSkills = await pg.handle.db
        .select({ skillId: t.agentSkills.skillId })
        .from(t.agentSkills)
        .where(eq(t.agentSkills.agentId, agentId))
        .orderBy(t.agentSkills.order);
      await pg.handle.db.insert(t.agentVersions).values({
        agentId,
        version: agentRow!.version,
        configJson: {
          provider: agentRow!.provider,
          model: agentRow!.model,
          system_prompt: agentRow!.systemPrompt,
          output_schema: agentRow!.outputSchema,
          strategy: agentRow!.strategy,
          ci_fail_on: agentRow!.ciFailOn,
          repo_intel: agentRow!.repoIntel,
          skills: linkedSkills.map((s) => s.skillId),
        },
      });

      // ---- batch 1: baseline prompt, mock misses the leak -----------------
      const b1Res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
      expect(b1Res.statusCode).toBe(200);

      // ---- strengthen the prompt (new agent version) + batch 2 ------------
      const strongRes = await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}`,
        payload: { system_prompt: STRONG_PROMPT },
      });
      expect(strongRes.statusCode).toBe(200);
      mockOpts.structured = STRONG_REVIEW;

      const b2Res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
      expect(b2Res.statusCode).toBe(200);

      // ---- corrupt the prompt (new agent version) + batch 3 ---------------
      const corruptRes = await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}`,
        payload: { system_prompt: CORRUPTED_PROMPT },
      });
      expect(corruptRes.statusCode).toBe(200);
      mockOpts.structured = CORRUPTED_REVIEW;

      const b3Res = await app.inject({ method: 'POST', url: `/agents/${agentId}/eval-runs` });
      expect(b3Res.statusCode).toBe(200);

      // ---- run history: 3 EvalBatchRow rows ---------------------------------
      const dashRes = await app.inject({ method: 'GET', url: `/agents/${agentId}/eval-dashboard` });
      expect(dashRes.statusCode).toBe(200);
      const dash = dashRes.json();
      expect(dash.batches).toHaveLength(3);
      for (const row of dash.batches) {
        expect(row.agent_id).toBe(agentId);
      }

      const batches = await evalsRepo.listBatches(agentId); // newest first
      expect(batches).toHaveLength(3);
      const [batch3, batch2, batch1] = batches;

      // ---- compare v1 → v2: metrics move + prompt diff renders (AC-44) -----
      const cmp12 = await app.inject({
        method: 'GET',
        url: `/agents/${agentId}/eval-compare?a=${batch1!.batchId}&b=${batch2!.batchId}`,
      });
      expect(cmp12.statusCode).toBe(200);
      const cmp12Body = cmp12.json();
      expect(cmp12Body.older.batch_id).toBe(batch1!.batchId);
      expect(cmp12Body.newer.batch_id).toBe(batch2!.batchId);
      // Baseline missed the leak on the stripe-key-leak case (0 matched of 1
      // expected there) while staying correctly silent on the clean-refactor
      // case (vacuous, 0 expected — contributes nothing to either side of the
      // ratio) — the batch-level metric is MICRO-averaged (AC-21/22/23: counts
      // summed across ALL cases, then divided): matchedExpectedTotal=0 /
      // expectedTotal=1 = 0. The strengthened prompt catches the leak too, so
      // both cases hit recall 1 → batch recall 1. Either way, the run history
      // visibly moves between the two versions.
      expect(cmp12Body.older.recall).toBe(0);
      expect(cmp12Body.newer.recall).toBe(1);
      expect(cmp12Body.deltas.recall).toBeGreaterThan(0);
      expect(cmp12Body.prompt_diff).not.toBeNull();
      expect(cmp12Body.prompt_diff.added.length).toBeGreaterThan(0);

      // ---- compare v2 → v3: precision DROPS on the corrupted version -------
      const cmp23 = await app.inject({
        method: 'GET',
        url: `/agents/${agentId}/eval-compare?a=${batch2!.batchId}&b=${batch3!.batchId}`,
      });
      expect(cmp23.statusCode).toBe(200);
      const cmp23Body = cmp23.json();
      expect(cmp23Body.older.batch_id).toBe(batch2!.batchId);
      expect(cmp23Body.newer.batch_id).toBe(batch3!.batchId);
      // Both versions still catch the real leak (recall unchanged)...
      expect(cmp23Body.older.recall).toBe(1);
      expect(cmp23Body.newer.recall).toBe(1);
      // ...but the corrupted prompt's extra "unused import" finding is
      // unmatched noise, so precision provably falls (AC-25/22 interaction).
      expect(cmp23Body.older.precision).toBe(1);
      expect(cmp23Body.newer.precision).toBeLessThan(cmp23Body.older.precision);
      expect(cmp23Body.deltas.precision).toBeLessThan(0);
      expect(cmp23Body.prompt_diff).not.toBeNull();

      await app.close();
    },
  );
});

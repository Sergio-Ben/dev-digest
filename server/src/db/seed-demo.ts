import { and, eq } from 'drizzle-orm';
import type { Db } from './client.js';
import * as t from './schema.js';
import { estimateCost } from '../adapters/llm/pricing.js';

/**
 * Demo PR fleet + PRICED agent runs — the data behind the COST column.
 *
 * Cost is never stored on `pull_requests`: the PR list sums `agent_runs.cost_usd`
 * on read, over the runs of the latest review "batch" (a 120s `ran_at` window
 * around the PR's newest priced run — see `modules/pulls/routes.ts`). So a PR
 * only shows a cost when it has `status='done'` runs with a non-null `cost_usd`,
 * and a multi-agent batch only sums when its runs share that window.
 *
 * The fixtures below deliberately cover every UI state of that column:
 *  - single priced run           → one cost
 *  - 2-3 runs inside the window  → summed cost
 *  - failed run                  → cost null → "—" (distinct from "$0.00")
 *  - free model (glm-4.7-flash)  → "$0.00"
 *  - no runs at all              → "—"
 *
 * Costs are computed with the real price book (`adapters/llm/pricing.ts`) rather
 * than hardcoded, so seeded numbers stay consistent with live runs.
 *
 * Idempotent: PRs are keyed by (repo, number) and runs are only inserted for a
 * PR that has none, so re-running `pnpm db:seed` never duplicates.
 */

const DAY_MS = 86_400_000;

interface DemoRun {
  /** Matches a seeded agent name; null agent_id if it isn't found. */
  agent: string;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  status: 'done' | 'failed';
  findings?: number;
  score?: number | null;
  blockers?: number;
  grounding?: string;
  error?: string;
  /** Seconds before the PR's run anchor — keep a batch inside 120s to sum. */
  offsetSec: number;
}

interface DemoFinding {
  file: string;
  startLine: number;
  endLine: number;
  severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION';
  category: string;
  title: string;
  rationale: string;
  suggestion: string;
  confidence: number;
}

interface DemoPull {
  number: number;
  /** Omitted for PRs the base seed already creates (e.g. #482) — runs only. */
  pr?: {
    title: string;
    author: string;
    branch: string;
    headSha: string;
    /** Set = current head was reviewed → list shows "reviewed"/"stale" + score. */
    lastReviewedSha: string | null;
    additions: number;
    deletions: number;
    filesCount: number;
    /** GitHub merge state: open | merged | closed. */
    status: string;
    body: string;
    openedDaysAgo: number;
    updatedDaysAgo: number;
  };
  files?: Array<{ path: string; additions: number; deletions: number }>;
  commits?: Array<{ sha: string; message: string; author: string }>;
  review?: {
    verdict: 'approve' | 'comment' | 'request_changes';
    summary: string;
    score: number;
    model: string;
    findings: DemoFinding[];
  };
  /** Days ago the run batch executed (anchor for each run's offsetSec). */
  runsDaysAgo: number;
  runs: DemoRun[];
}

const DEMO_PULLS: DemoPull[] = [
  // #482 already exists from the base seed (review + findings, never "reviewed"
  // against its head). Two priced runs give the demo PR a summed batch cost.
  {
    number: 482,
    runsDaysAgo: 1,
    runs: [
      {
        agent: 'General Reviewer',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        tokensIn: 18_420,
        tokensOut: 1_360,
        durationMs: 7_800,
        status: 'done',
        findings: 2,
        score: 61,
        blockers: 1,
        grounding: '2/2 passed',
        offsetSec: 0,
      },
      {
        agent: 'Security Reviewer',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        tokensIn: 16_900,
        tokensOut: 980,
        durationMs: 6_100,
        status: 'done',
        findings: 1,
        score: 58,
        blockers: 1,
        grounding: '1/1 passed',
        offsetSec: 55,
      },
    ],
  },

  // Merged PR, reviewed by an expensive frontier batch → dollar-scale cost.
  {
    number: 483,
    pr: {
      title: 'Cache invalidation on order webhook',
      author: 'devon.aluko',
      branch: 'fix/order-webhook-cache',
      headSha: 'b7c9012de345',
      lastReviewedSha: 'b7c9012de345',
      additions: 132,
      deletions: 91,
      filesCount: 6,
      status: 'merged',
      body: 'Stale order totals were served after a webhook update. Invalidate the order cache key on every `order.updated` event.',
      openedDaysAgo: 9,
      updatedDaysAgo: 4,
    },
    files: [
      { path: 'src/cache/order-cache.ts', additions: 46, deletions: 22 },
      { path: 'src/api/webhooks/orders.ts', additions: 58, deletions: 41 },
      { path: 'test/order-cache.test.ts', additions: 28, deletions: 28 },
    ],
    commits: [
      { sha: 'b7c9012de345', message: 'Invalidate order cache on webhook', author: 'devon.aluko' },
      { sha: 'a3311fbc0091', message: 'Add regression test for stale totals', author: 'devon.aluko' },
    ],
    review: {
      verdict: 'approve',
      summary:
        'Correct invalidation on the update path. One suggestion: the cache key builder duplicates logic already in `keys.ts`.',
      score: 88,
      model: 'gpt-5.4',
      findings: [
        {
          file: 'src/cache/order-cache.ts',
          startLine: 31,
          endLine: 38,
          severity: 'SUGGESTION',
          category: 'maintainability',
          title: 'Duplicate cache-key construction',
          rationale: 'Key format is rebuilt here instead of reusing `buildOrderKey` from `keys.ts`.',
          suggestion: 'Import `buildOrderKey` so the format lives in one place.',
          confidence: 0.74,
        },
      ],
    },
    runsDaysAgo: 4,
    runs: [
      {
        agent: 'General Reviewer',
        provider: 'openai',
        model: 'gpt-5.4',
        tokensIn: 42_300,
        tokensOut: 3_150,
        durationMs: 21_400,
        status: 'done',
        findings: 1,
        score: 88,
        blockers: 0,
        grounding: '1/1 passed',
        offsetSec: 0,
      },
      {
        agent: 'Security Reviewer',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-latest',
        tokensIn: 38_900,
        tokensOut: 2_240,
        durationMs: 18_900,
        status: 'done',
        findings: 0,
        score: 92,
        blockers: 0,
        grounding: 'n/a',
        offsetSec: 48,
      },
    ],
  },

  // Three-agent batch, all inside the 120s window → the summed-cost case.
  {
    number: 484,
    pr: {
      title: 'Migrate session store to Redis',
      author: 'priya.raman',
      branch: 'chore/redis-sessions',
      headSha: 'c4d5e6f70812',
      lastReviewedSha: 'c4d5e6f70812',
      additions: 418,
      deletions: 156,
      filesCount: 14,
      status: 'open',
      body: 'Move sessions off in-memory storage so we can run more than one API pod. Adds a Redis-backed store behind the existing `SessionStore` interface.',
      openedDaysAgo: 5,
      updatedDaysAgo: 1,
    },
    files: [
      { path: 'src/session/redis-store.ts', additions: 174, deletions: 0 },
      { path: 'src/session/index.ts', additions: 38, deletions: 96 },
      { path: 'src/config.ts', additions: 12, deletions: 3 },
      { path: 'docker-compose.yml', additions: 9, deletions: 0 },
    ],
    commits: [
      { sha: 'c4d5e6f70812', message: 'Add Redis session store', author: 'priya.raman' },
      { sha: '90ab12cd34ef', message: 'Wire store selection through config', author: 'priya.raman' },
    ],
    review: {
      verdict: 'request_changes',
      summary:
        'Solid abstraction, but sessions are written without a TTL (unbounded memory growth) and the Redis client has no reconnect policy.',
      score: 67,
      model: 'z-ai/glm-5.1',
      findings: [
        {
          file: 'src/session/redis-store.ts',
          startLine: 88,
          endLine: 94,
          severity: 'CRITICAL',
          category: 'reliability',
          title: 'Session keys written without TTL',
          rationale: '`SET` is called with no expiry, so abandoned sessions never leave Redis.',
          suggestion: 'Use `SET key value EX <sessionTtlSeconds>` and derive the TTL from config.',
          confidence: 0.93,
        },
        {
          file: 'src/session/redis-store.ts',
          startLine: 21,
          endLine: 27,
          severity: 'WARNING',
          category: 'reliability',
          title: 'No reconnect strategy on the Redis client',
          rationale: 'A dropped connection surfaces as a 500 on every request until the pod restarts.',
          suggestion: 'Configure `retryStrategy` with capped backoff and fail requests fast while down.',
          confidence: 0.81,
        },
        {
          file: 'src/config.ts',
          startLine: 44,
          endLine: 44,
          severity: 'SUGGESTION',
          category: 'maintainability',
          title: 'Redis URL lacks a validated default',
          rationale: 'A missing `REDIS_URL` fails at first request instead of at boot.',
          suggestion: 'Validate `REDIS_URL` in the config schema so boot fails loudly.',
          confidence: 0.7,
        },
      ],
    },
    runsDaysAgo: 1,
    runs: [
      {
        agent: 'General Reviewer',
        provider: 'openrouter',
        model: 'z-ai/glm-5.1',
        tokensIn: 61_500,
        tokensOut: 4_100,
        durationMs: 26_700,
        status: 'done',
        findings: 3,
        score: 67,
        blockers: 1,
        grounding: '3/3 passed',
        offsetSec: 0,
      },
      {
        agent: 'Security Reviewer',
        provider: 'openrouter',
        model: 'minimax/minimax-m2.5',
        tokensIn: 57_800,
        tokensOut: 2_900,
        durationMs: 19_300,
        status: 'done',
        findings: 1,
        score: 71,
        blockers: 0,
        grounding: '1/1 passed',
        offsetSec: 42,
      },
      {
        agent: 'Performance Reviewer',
        provider: 'openrouter',
        model: 'deepseek/deepseek-v4-flash',
        tokensIn: 55_200,
        tokensOut: 2_050,
        durationMs: 14_800,
        status: 'done',
        findings: 1,
        score: 74,
        blockers: 0,
        grounding: '1/1 passed',
        offsetSec: 96,
      },
    ],
  },

  // Failed run → cost stays null → "—" in the list and the run history.
  {
    number: 485,
    pr: {
      title: 'Fix flaky checkout e2e spec',
      author: 'marisa.koch',
      branch: 'fix/flaky-checkout-e2e',
      headSha: 'd1e2f3a45566',
      lastReviewedSha: null,
      additions: 63,
      deletions: 47,
      filesCount: 3,
      status: 'open',
      body: 'The checkout spec raced the payment webhook. Wait on the order status instead of a fixed timeout.',
      openedDaysAgo: 2,
      updatedDaysAgo: 0,
    },
    files: [
      { path: 'e2e/checkout.spec.ts', additions: 41, deletions: 39 },
      { path: 'e2e/support/wait.ts', additions: 22, deletions: 8 },
    ],
    commits: [
      { sha: 'd1e2f3a45566', message: 'Replace fixed timeout with status poll', author: 'marisa.koch' },
    ],
    runsDaysAgo: 0,
    runs: [
      {
        agent: 'General Reviewer',
        provider: 'openrouter',
        model: 'z-ai/glm-5.1',
        tokensIn: 0,
        tokensOut: 0,
        durationMs: 3_200,
        status: 'failed',
        error: 'provider returned 429: rate limit exceeded (retry after 60s)',
        offsetSec: 0,
      },
    ],
  },

  // Reviewed but untouched for >7 days → derives to "stale". Free model → "$0.00",
  // which must stay visually distinct from the "—" of an un-priced run.
  {
    number: 486,
    pr: {
      title: 'Add OpenTelemetry spans to the payment flow',
      author: 'tomas.iversen',
      branch: 'feat/otel-payment-spans',
      headSha: 'e9f8a7b6c5d4',
      lastReviewedSha: 'e9f8a7b6c5d4',
      additions: 208,
      deletions: 12,
      filesCount: 8,
      status: 'open',
      body: 'Instrument authorize/capture/refund with spans so we can see where the p99 goes.',
      openedDaysAgo: 21,
      updatedDaysAgo: 12,
    },
    files: [
      { path: 'src/telemetry/spans.ts', additions: 96, deletions: 0 },
      { path: 'src/payments/authorize.ts', additions: 44, deletions: 6 },
      { path: 'src/payments/capture.ts', additions: 38, deletions: 4 },
    ],
    commits: [
      { sha: 'e9f8a7b6c5d4', message: 'Instrument payment flow with OTel spans', author: 'tomas.iversen' },
    ],
    review: {
      verdict: 'comment',
      summary: 'Spans are well placed. Card metadata on span attributes is the one thing to fix before merge.',
      score: 79,
      model: 'z-ai/glm-4.7-flash',
      findings: [
        {
          file: 'src/payments/authorize.ts',
          startLine: 57,
          endLine: 59,
          severity: 'WARNING',
          category: 'security',
          title: 'Card BIN written to a span attribute',
          rationale: 'Span attributes are exported to the tracing backend, putting cardholder data outside PCI scope.',
          suggestion: 'Drop the attribute or hash it before setting it on the span.',
          confidence: 0.88,
        },
      ],
    },
    runsDaysAgo: 12,
    runs: [
      {
        agent: 'Performance Reviewer',
        provider: 'openrouter',
        model: 'z-ai/glm-4.7-flash',
        tokensIn: 33_100,
        tokensOut: 1_780,
        durationMs: 11_900,
        status: 'done',
        findings: 1,
        score: 79,
        blockers: 0,
        grounding: '1/1 passed',
        offsetSec: 0,
      },
    ],
  },

  // Never reviewed: no runs at all → cost "—" and score "—".
  {
    number: 487,
    pr: {
      title: 'Bump dependencies and drop Node 18',
      author: 'devon.aluko',
      branch: 'chore/deps-drop-node18',
      headSha: 'f0e1d2c3b4a5',
      lastReviewedSha: null,
      additions: 1_042,
      deletions: 987,
      filesCount: 4,
      status: 'open',
      body: 'Routine dependency bump. CI matrix drops Node 18 (EOL) and adds Node 24.',
      openedDaysAgo: 1,
      updatedDaysAgo: 0,
    },
    files: [
      { path: 'package.json', additions: 34, deletions: 31 },
      { path: 'pnpm-lock.yaml', additions: 986, deletions: 949 },
      { path: '.github/workflows/ci.yml', additions: 22, deletions: 7 },
    ],
    commits: [
      { sha: 'f0e1d2c3b4a5', message: 'Bump deps, drop Node 18 from the CI matrix', author: 'devon.aluko' },
    ],
    runsDaysAgo: 0,
    runs: [],
  },
];

/**
 * Seed the demo PR fleet and its priced runs. Call AFTER the built-in agents
 * exist — runs are attributed to them by name.
 */
export async function seedDemoPullsAndRuns(
  db: Db,
  args: { workspaceId: string; repoId: string },
): Promise<{ pullsCreated: number; runsCreated: number }> {
  const { workspaceId, repoId } = args;
  const now = Date.now();

  const agentRows = await db
    .select({ id: t.agents.id, name: t.agents.name })
    .from(t.agents)
    .where(eq(t.agents.workspaceId, workspaceId));
  const agentIdByName = new Map(agentRows.map((a) => [a.name, a.id]));

  let pullsCreated = 0;
  let runsCreated = 0;

  for (const demo of DEMO_PULLS) {
    // ---- PR (keyed by repo + number; `pr_repo_number_uq` keeps this idempotent) ----
    let [pr] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.repoId, repoId), eq(t.pullRequests.number, demo.number)));

    if (!pr) {
      if (!demo.pr) continue; // runs-only entry whose PR the base seed owns
      const spec = demo.pr;
      [pr] = await db
        .insert(t.pullRequests)
        .values({
          workspaceId,
          repoId,
          number: demo.number,
          title: spec.title,
          author: spec.author,
          branch: spec.branch,
          base: 'main',
          headSha: spec.headSha,
          lastReviewedSha: spec.lastReviewedSha,
          additions: spec.additions,
          deletions: spec.deletions,
          filesCount: spec.filesCount,
          status: spec.status,
          body: spec.body,
          openedAt: new Date(now - spec.openedDaysAgo * DAY_MS),
          updatedAt: new Date(now - spec.updatedDaysAgo * DAY_MS),
        })
        .returning();
      pullsCreated += 1;

      if (demo.files?.length) {
        await db
          .insert(t.prFiles)
          .values(demo.files.map((f) => ({ prId: pr!.id, ...f })));
      }
      if (demo.commits?.length) {
        await db.insert(t.prCommits).values(
          demo.commits.map((c) => ({
            prId: pr!.id,
            ...c,
            committedAt: new Date(now - spec.updatedDaysAgo * DAY_MS),
          })),
        );
      }
    }
    const prId = pr!.id;

    // ---- runs (only when the PR has none, so re-seeding can't duplicate) ----
    const existingRuns = await db
      .select({ id: t.agentRuns.id })
      .from(t.agentRuns)
      .where(eq(t.agentRuns.prId, prId));
    if (existingRuns.length > 0 || demo.runs.length === 0) continue;

    const anchor = now - demo.runsDaysAgo * DAY_MS;
    const insertedRunIds: string[] = [];
    for (const r of demo.runs) {
      // Failed runs stay un-priced (null → "—"); done runs use the real price
      // book, so an unknown model would surface as null here too, not $0.
      const costUsd = r.status === 'done' ? estimateCost(r.model, r.tokensIn, r.tokensOut) : null;
      const [row] = await db
        .insert(t.agentRuns)
        .values({
          workspaceId,
          agentId: agentIdByName.get(r.agent) ?? null,
          prId,
          ranAt: new Date(anchor - r.offsetSec * 1_000),
          provider: r.provider,
          model: r.model,
          durationMs: r.durationMs,
          tokensIn: r.tokensIn,
          tokensOut: r.tokensOut,
          costUsd,
          status: r.status,
          error: r.error ?? null,
          source: 'local',
          findingsCount: r.findings ?? null,
          grounding: r.grounding ?? null,
          score: r.score ?? null,
          blockers: r.blockers ?? null,
        })
        .returning({ id: t.agentRuns.id });
      insertedRunIds.push(row!.id);
      runsCreated += 1;
    }

    // ---- review + findings (skipped when the PR already has one) ----
    if (!demo.review) continue;
    const [existingReview] = await db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(and(eq(t.reviews.prId, prId), eq(t.reviews.kind, 'review')));
    if (existingReview) continue;

    const [review] = await db
      .insert(t.reviews)
      .values({
        workspaceId,
        prId,
        // Links the timeline run ↔ review (reviews.run_id has no FK).
        runId: insertedRunIds[0] ?? null,
        kind: 'review',
        verdict: demo.review.verdict,
        summary: demo.review.summary,
        score: demo.review.score,
        model: demo.review.model,
        createdAt: new Date(anchor),
      })
      .returning();
    if (demo.review.findings.length > 0) {
      await db
        .insert(t.findings)
        .values(demo.review.findings.map((f) => ({ reviewId: review!.id, ...f })));
    }
  }

  return { pullsCreated, runsCreated };
}

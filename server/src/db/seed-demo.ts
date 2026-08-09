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
  files?: Array<{ path: string; additions: number; deletions: number; patch?: string }>;
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
      // additions/deletions/filesCount are the sum of `files` below (only
      // this workspace's demo diff — see seed-demo.ts patch notes).
      additions: 34,
      deletions: 9,
      filesCount: 3,
      status: 'merged',
      body: 'Stale order totals were served after a webhook update. Invalidate the order cache key on every `order.updated` event.',
      openedDaysAgo: 9,
      updatedDaysAgo: 4,
    },
    files: [
      {
        path: 'src/cache/order-cache.ts',
        additions: 11,
        deletions: 4,
        patch: [
          '@@ -1,7 +1,8 @@',
          " import { redis } from '../lib/redis.js';",
          "+import { buildOrderKey } from './keys.js';",
          ' ',
          ' const TTL_SECONDS = 300;',
          ' ',
          '-export function getOrderCache(orderId: string) {',
          '-  return redis.get(`order:${orderId}`);',
          '+export function getOrderCache(orderId: string) {',
          '+  return redis.get(buildOrderKey(orderId));',
          ' }',
          '@@ -30,4 +31,10 @@',
          ' ',
          '-export function invalidateOrderCache(orderId: string) {',
          '-  return redis.del(`order:${orderId}`);',
          '+export function invalidateOrderCache(orderId: string) {',
          '+  const key = `order:${orderId}`;',
          '+  return redis.del(key);',
          '+}',
          '+',
          '+export function invalidateOrdersBatch(orderIds: string[]) {',
          '+  const keys = orderIds.map((id) => `order:${id}`);',
          '+  return redis.del(...keys);',
          ' }',
        ].join('\n'),
      },
      {
        path: 'src/api/webhooks/orders.ts',
        additions: 12,
        deletions: 2,
        patch: [
          '@@ -1,17 +1,27 @@',
          " import { Router } from 'express';",
          "+import { invalidateOrderCache } from '../../cache/order-cache.js';",
          " import { verifyWebhookSignature } from '../../lib/webhooks.js';",
          " import { logger } from '../../lib/logger.js';",
          ' ',
          ' const router = Router();',
          ' ',
          " router.post('/orders', async (req, res) => {",
          "   const signature = req.headers['x-webhook-signature'];",
          '   if (!verifyWebhookSignature(req.body, signature)) {',
          "     return res.status(401).json({ error: 'invalid signature' });",
          '   }',
          ' ',
          '-  const event = req.body;',
          "-  logger.info('order webhook received', { type: event.type });",
          '+  const event = req.body;',
          "+  logger.info('order webhook received', { type: event.type });",
          '+',
          "+  if (event.type === 'order.updated') {",
          '+    await invalidateOrderCache(event.data.orderId);',
          "+    logger.info('order cache invalidated', { orderId: event.data.orderId });",
          '+  }',
          '+',
          "+  if (event.type === 'order.cancelled') {",
          '+    await invalidateOrderCache(event.data.orderId);',
          '+  }',
          ' ',
          '   res.status(200).json({ received: true });',
          ' });',
        ].join('\n'),
      },
      {
        path: 'test/order-cache.test.ts',
        additions: 11,
        deletions: 3,
        patch: [
          '@@ -1,9 +1,17 @@',
          " import { describe, it, expect, vi } from 'vitest';",
          " import { redis } from '../src/lib/redis.js';",
          " import { invalidateOrderCache, getOrderCache } from '../src/cache/order-cache.js';",
          ' ',
          " describe('order-cache', () => {",
          "-  it('gets a cached order', async () => {",
          '-    // TODO',
          '-  });',
          "+  it('gets a cached order', async () => {",
          "+    const spy = vi.spyOn(redis, 'get').mockResolvedValue('{}');",
          "+    await getOrderCache('123');",
          "+    expect(spy).toHaveBeenCalledWith('order:123');",
          '+  });',
          '+',
          "+  it('invalidates the cache on webhook update', async () => {",
          "+    const spy = vi.spyOn(redis, 'del').mockResolvedValue(1);",
          "+    await invalidateOrderCache('123');",
          "+    expect(spy).toHaveBeenCalledWith('order:123');",
          '+  });',
          ' });',
        ].join('\n'),
      },
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
      // additions/deletions/filesCount are the sum of `files` below.
      additions: 105,
      deletions: 3,
      filesCount: 4,
      status: 'open',
      body: 'Move sessions off in-memory storage so we can run more than one API pod. Adds a Redis-backed store behind the existing `SessionStore` interface.',
      openedDaysAgo: 5,
      updatedDaysAgo: 1,
    },
    files: [
      {
        path: 'src/session/redis-store.ts',
        additions: 95,
        deletions: 0,
        patch: [
          '@@ -0,0 +1,95 @@',
          "+import Redis from 'ioredis';",
          "+import type { SessionStore, SessionData } from './types.js';",
          "+import { config } from '../config.js';",
          '+',
          "+const SESSION_PREFIX = 'sess:';",
          '+',
          '+export class RedisSessionStore implements SessionStore {',
          '+  private client: Redis;',
          '+',
          '+  constructor(url: string) {',
          '+    this.client = new Redis(url);',
          '+    this.connect();',
          '+  }',
          '+',
          '+  private connect() {',
          "+    this.client.on('connect', () => {",
          "+      console.log('redis session store connected');",
          '+    });',
          '+  }',
          '+',
          '+  private connectErrorHandler() {',
          "+    this.client.on('error', (err) => {",
          "+      console.error('redis session store error', err);",
          '+    });',
          '+    // TODO: no retry/backoff configured — a dropped connection will',
          '+    // surface as request failures until the process is restarted.',
          '+  }',
          '+',
          '+  private key(sessionId: string): string {',
          '+    return `${SESSION_PREFIX}${sessionId}`;',
          '+  }',
          '+',
          '+  async get(sessionId: string): Promise<SessionData | null> {',
          '+    const raw = await this.client.get(this.key(sessionId));',
          '+    if (!raw) return null;',
          '+    return JSON.parse(raw) as SessionData;',
          '+  }',
          '+',
          '+  async touch(sessionId: string): Promise<void> {',
          '+    await this.client.expire(this.key(sessionId), config.sessionTtlSeconds);',
          '+  }',
          '+',
          '+  async destroy(sessionId: string): Promise<void> {',
          '+    await this.client.del(this.key(sessionId));',
          '+  }',
          '+',
          '+  async all(): Promise<string[]> {',
          '+    const keys = await this.client.keys(`${SESSION_PREFIX}*`);',
          '+    return keys;',
          '+  }',
          '+',
          '+  async count(): Promise<number> {',
          '+    const keys = await this.all();',
          '+    return keys.length;',
          '+  }',
          '+',
          '+  async clear(): Promise<void> {',
          '+    const keys = await this.all();',
          '+    if (keys.length === 0) return;',
          '+    await this.client.del(...keys);',
          '+  }',
          '+',
          '+  async has(sessionId: string): Promise<boolean> {',
          '+    const exists = await this.client.exists(this.key(sessionId));',
          '+    return exists === 1;',
          '+  }',
          '+',
          '+  async rename(oldId: string, newId: string): Promise<void> {',
          '+    await this.client.rename(this.key(oldId), this.key(newId));',
          '+  }',
          '+',
          '+  async merge(sessionId: string, patch: Partial<SessionData>): Promise<void> {',
          '+    const current = await this.get(sessionId);',
          '+    await this.set(sessionId, { ...current, ...patch } as SessionData);',
          '+  }',
          '+',
          '+  async ping(): Promise<boolean> {',
          '+    const res = await this.client.ping();',
          "+    return res === 'PONG';",
          '+  }',
          '+',
          '+  async disconnect(): Promise<void> {',
          '+    await this.client.quit();',
          '+  }',
          '+',
          '+  async set(sessionId: string, data: SessionData): Promise<void> {',
          '+    const payload = JSON.stringify(data);',
          '+    const key = this.key(sessionId);',
          '+    await this.client.set(key, payload);',
          '+    // No TTL is passed to SET here, so entries never expire and',
          '+    // abandoned sessions accumulate in Redis indefinitely. A TTL',
          '+    // should be derived from config.sessionTtlSeconds and passed',
          '+    // via `SET key value EX <ttl>`.',
          '+  }',
          '+}',
        ].join('\n'),
      },
      {
        path: 'src/session/index.ts',
        additions: 3,
        deletions: 3,
        patch: [
          '@@ -1,9 +1,9 @@',
          " import type { SessionStore } from './types.js';",
          "-import { MemorySessionStore } from './memory-store.js';",
          "+import { RedisSessionStore } from './redis-store.js';",
          " import { config } from '../config.js';",
          ' ',
          ' export function createSessionStore(): SessionStore {',
          '-  return new MemorySessionStore();',
          '-}',
          '+  return new RedisSessionStore(config.redisUrl);',
          '+}',
          ' ',
          " export type { SessionStore, SessionData } from './types.js';",
        ].join('\n'),
      },
      {
        path: 'src/config.ts',
        additions: 3,
        deletions: 0,
        patch: [
          '@@ -1,6 +1,7 @@',
          " import { z } from 'zod';",
          ' ',
          ' const envSchema = z.object({',
          '   PORT: z.coerce.number().default(3000),',
          "+  REDIS_URL: z.string().optional(),",
          '   DATABASE_URL: z.string(),',
          ' });',
          '@@ -38,5 +39,7 @@',
          ' ',
          ' export const config = {',
          '   port: env.PORT,',
          '   databaseUrl: env.DATABASE_URL,',
          '+  sessionTtlSeconds: 60 * 60 * 24,',
          '+  redisUrl: env.REDIS_URL,',
          ' };',
        ].join('\n'),
      },
      {
        path: 'docker-compose.yml',
        additions: 4,
        deletions: 0,
        patch: [
          '@@ -1,5 +1,9 @@',
          ' services:',
          '   api:',
          '     build: .',
          '     ports:',
          "       - '3000:3000'",
          '+  redis:',
          '+    image: redis:7-alpine',
          '+    ports:',
          "+      - '6379:6379'",
        ].join('\n'),
      },
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
      // additions/deletions/filesCount are the sum of `files` below.
      additions: 9,
      deletions: 4,
      filesCount: 2,
      status: 'open',
      body: 'The checkout spec raced the payment webhook. Wait on the order status instead of a fixed timeout.',
      openedDaysAgo: 2,
      updatedDaysAgo: 0,
    },
    files: [
      {
        path: 'e2e/checkout.spec.ts',
        additions: 1,
        deletions: 1,
        patch: [
          '@@ -1,10 +1,10 @@',
          " import { test, expect } from '@playwright/test';",
          " import { waitForOrderStatus } from './support/wait.js';",
          ' ',
          " test('checkout completes after payment webhook', async ({ page }) => {",
          "   await page.goto('/checkout');",
          "   await page.fill('#card-number', '4242424242424242');",
          "   await page.click('#pay-button');",
          '-  await page.waitForTimeout(5000);',
          "+  await waitForOrderStatus(page, 'paid');",
          "   await expect(page.locator('#order-status')).toHaveText('Paid');",
          ' });',
        ].join('\n'),
      },
      {
        path: 'e2e/support/wait.ts',
        additions: 8,
        deletions: 3,
        patch: [
          '@@ -1,6 +1,11 @@',
          " import type { Page } from '@playwright/test';",
          ' ',
          '-export async function waitForOrderStatus(page: Page) {',
          '-  await page.waitForTimeout(5000);',
          '-}',
          '+export async function waitForOrderStatus(page: Page, status: string) {',
          '+  await page.waitForFunction(',
          '+    (expected) => document.querySelector(',
          "+      '#order-status',",
          '+    )?.textContent === expected,',
          '+    status,',
          '+    { timeout: 15_000 },',
          '+  );',
          ' }',
        ].join('\n'),
      },
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
      // additions/deletions/filesCount are the sum of `files` below.
      additions: 27,
      deletions: 4,
      filesCount: 3,
      status: 'open',
      body: 'Instrument authorize/capture/refund with spans so we can see where the p99 goes.',
      openedDaysAgo: 21,
      updatedDaysAgo: 12,
    },
    files: [
      {
        path: 'src/telemetry/spans.ts',
        additions: 18,
        deletions: 0,
        patch: [
          '@@ -0,0 +1,18 @@',
          "+import { trace } from '@opentelemetry/api';",
          '+',
          "+const tracer = trace.getTracer('payments-api');",
          '+',
          '+export function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T> {',
          '+  return tracer.startActiveSpan(name, async (span) => {',
          '+    try {',
          '+      return await fn();',
          '+    } finally {',
          '+      span.end();',
          '+    }',
          '+  });',
          '+}',
          '+',
          '+export function setSpanAttribute(key: string, value: string | number) {',
          '+  const span = trace.getActiveSpan();',
          '+  span?.setAttribute(key, value);',
          '+}',
        ].join('\n'),
      },
      {
        path: 'src/payments/authorize.ts',
        additions: 5,
        deletions: 2,
        patch: [
          '@@ -1,6 +1,8 @@',
          " import { withSpan, setSpanAttribute } from '../telemetry/spans.js';",
          " import { chargeCard } from './gateway.js';",
          ' ',
          '-export async function authorize(order: Order, card: Card) {',
          '-  return chargeCard(order, card);',
          '+export async function authorize(order: Order, card: Card) {',
          "+  return withSpan('payments.authorize', async () => {",
          '+    return chargeCard(order, card);',
          '+  });',
          ' }',
          '@@ -52,5 +54,6 @@',
          ' function recordCardMetadata(card: Card) {',
          "   setSpanAttribute('payments.card.brand', card.brand);",
          "   setSpanAttribute('payments.card.last4', card.last4);",
          "+  setSpanAttribute('payments.card.bin', card.bin);",
          ' }',
          ' ',
        ].join('\n'),
      },
      {
        path: 'src/payments/capture.ts',
        additions: 4,
        deletions: 2,
        patch: [
          '@@ -1,6 +1,8 @@',
          " import { withSpan } from '../telemetry/spans.js';",
          " import { captureCharge } from './gateway.js';",
          ' ',
          '-export async function capture(chargeId: string, amount: number) {',
          '-  return captureCharge(chargeId, amount);',
          '+export async function capture(chargeId: string, amount: number) {',
          "+  return withSpan('payments.capture', async () => {",
          '+    return captureCharge(chargeId, amount);',
          '+  });',
          ' }',
        ].join('\n'),
      },
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
      // additions/deletions/filesCount are the sum of `files` below. The real
      // pnpm-lock.yaml diff for a Node bump is huge; we seed a realistic
      // excerpt (a few dependency bumps) rather than thousands of lines —
      // it's the Smart Diff "boilerplate stays collapsed" demo file.
      additions: 5,
      deletions: 5,
      filesCount: 3,
      status: 'open',
      body: 'Routine dependency bump. CI matrix drops Node 18 (EOL) and adds Node 24.',
      openedDaysAgo: 1,
      updatedDaysAgo: 0,
    },
    files: [
      {
        path: 'package.json',
        additions: 2,
        deletions: 2,
        patch: [
          '@@ -1,9 +1,9 @@',
          ' {',
          '   "name": "payments-api",',
          '   "engines": {',
          '-    "node": ">=18"',
          '+    "node": ">=24"',
          '   },',
          '   "dependencies": {',
          '-    "express": "^4.18.2"',
          '+    "express": "^4.19.2"',
          '   }',
          ' }',
        ].join('\n'),
      },
      {
        path: 'pnpm-lock.yaml',
        additions: 2,
        deletions: 2,
        patch: [
          '@@ -12,6 +12,6 @@',
          '   express:',
          '-    version: 4.18.2',
          '+    version: 4.19.2',
          '     resolution: {integrity: sha512-abc123==}',
          '   ioredis:',
          '-    version: 5.3.2',
          '+    version: 5.4.1',
          '     resolution: {integrity: sha512-def456==}',
        ].join('\n'),
      },
      {
        path: '.github/workflows/ci.yml',
        additions: 1,
        deletions: 1,
        patch: [
          '@@ -1,7 +1,7 @@',
          ' jobs:',
          '   test:',
          '     strategy:',
          '       matrix:',
          '-        node: [18, 20]',
          '+        node: [20, 24]',
          '     steps:',
          '       - uses: actions/checkout@v4',
        ].join('\n'),
      },
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

    // ---- files (refreshed every run, mirroring GET /pulls/:id's delete+re-insert,
    // so re-seeding an already-seeded DB backfills `patch` on existing rows) ----
    if (demo.files?.length) {
      await db.delete(t.prFiles).where(eq(t.prFiles.prId, prId));
      await db.insert(t.prFiles).values(demo.files.map((f) => ({ prId, ...f })));

      // Keep the PR row's headline totals equal to the sum of those files.
      // They're written only at PR creation, so a DB seeded before the patch
      // text existed would show a header (e.g. +1042 / -987 / 3 files) that
      // contradicts the handful of files actually rendered beneath it.
      await db
        .update(t.pullRequests)
        .set({
          additions: demo.files.reduce((n, f) => n + f.additions, 0),
          deletions: demo.files.reduce((n, f) => n + f.deletions, 0),
          filesCount: demo.files.length,
        })
        .where(eq(t.pullRequests.id, prId));
    }

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

import { describe, it, expect } from 'vitest';
import { createSingleFlight } from '../src/platform/single-flight.js';
import type { BriefResponse } from '@devdigest/shared';

/**
 * brief-single-flight.test.ts — T7's contract exercised in a brief-shaped
 * scenario (AC-27): keyed by prId, wrapping a compose-like async function
 * that returns a `BriefResponse`.
 *
 * `server/test/single-flight.test.ts` (T7's own file) already proves the
 * generic `createSingleFlight` contract in isolation, and
 * `server/test/brief-service.it.test.ts` proves AC-27 end-to-end through
 * `BriefService.getOrCompose` — but that integration test is Docker-gated
 * (Testcontainers) and is skipped entirely when Docker isn't available. This
 * file closes that hermetic gap: it proves the coalescing behaviour holds
 * for the exact shape `BriefService` uses it for (keyed by `prId`, wrapping
 * an async "compose" call that resolves to a `BriefResponse`), without any DB
 * or LLM dependency, so AC-27 always has at least one passing test in the
 * no-Docker hermetic suite.
 */

function fakeBriefResponse(overrides: Partial<BriefResponse> = {}): BriefResponse {
  return {
    brief: {
      what: 'Adds rate limiting middleware.',
      why: 'Prevents abuse of the public API.',
      risk_level: 'low',
      risks: [],
      review_focus: [],
    },
    degraded_inputs: [],
    head_sha: 'a1b2c3d4',
    generated_at: '2026-08-18T00:00:00.000Z',
    provider: 'openai',
    model: 'gpt-4.1',
    tokens: null,
    ...overrides,
  };
}

describe('createSingleFlight in a brief-shaped scenario (AC-27)', () => {
  it('two concurrent composes for the same prId invoke the underlying compose function exactly once and both callers get the identical BriefResponse', async () => {
    const singleFlight = createSingleFlight<BriefResponse>();
    let composeCalls = 0;
    const response = fakeBriefResponse();

    const composeForPr = (prId: string) =>
      singleFlight(prId, () =>
        new Promise<BriefResponse>((resolve) => {
          composeCalls++;
          setTimeout(() => resolve(response), 5);
        }),
      );

    const prId = 'pr-482';
    const [a, b] = await Promise.all([composeForPr(prId), composeForPr(prId)]);

    expect(composeCalls).toBe(1);
    expect(a).toBe(response);
    expect(b).toBe(response);
    expect(a).toEqual(b);
  });

  it('composes for two different prIds run independently — one call each, keyed apart', async () => {
    const singleFlight = createSingleFlight<BriefResponse>();
    const callsByPr: Record<string, number> = {};

    const composeForPr = (prId: string, brief: BriefResponse) =>
      singleFlight(prId, () => {
        callsByPr[prId] = (callsByPr[prId] ?? 0) + 1;
        return Promise.resolve(brief);
      });

    const [a, b] = await Promise.all([
      composeForPr('pr-1', fakeBriefResponse({ head_sha: 'sha-1' })),
      composeForPr('pr-2', fakeBriefResponse({ head_sha: 'sha-2' })),
    ]);

    expect(callsByPr).toEqual({ 'pr-1': 1, 'pr-2': 1 });
    expect(a.head_sha).toBe('sha-1');
    expect(b.head_sha).toBe('sha-2');
  });

  it('a failed compose (e.g. a forced provider error) is not cached — the next request for the same prId re-invokes compose (mirrors AC-32: no poisoned cache entry)', async () => {
    const singleFlight = createSingleFlight<BriefResponse>();
    let attempts = 0;
    const prId = 'pr-482';

    const failingCompose = () => {
      attempts++;
      return Promise.reject(new Error('provider outage'));
    };

    await expect(singleFlight(prId, failingCompose)).rejects.toThrow('provider outage');
    expect(attempts).toBe(1);

    const goodResponse = fakeBriefResponse();
    const recovered = await singleFlight(prId, () => {
      attempts++;
      return Promise.resolve(goodResponse);
    });

    expect(attempts).toBe(2);
    expect(recovered).toBe(goodResponse);
  });
});

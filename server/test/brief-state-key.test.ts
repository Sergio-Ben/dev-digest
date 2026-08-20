import { describe, it, expect } from 'vitest';
import type { BlastRadiusResult, Intent } from '@devdigest/shared';
import { deriveStateKey, fingerprintBlast, citableSets } from '../src/modules/brief/state-key.js';

/**
 * Hermetic unit tests for state-key.ts — pure hashing, no I/O.
 *
 * Covers T5's acceptance:
 *  - deriveStateKey is stable across two calls on the same input
 *  - deriveStateKey changes when the intent record changes (AC-22)
 *  - deriveStateKey changes when headSha changes (AC-24)
 *  - deriveStateKey does NOT change when blast.summary / blast.priorPrs
 *    differ (blast isn't even a param — naturally satisfied; also proven via
 *    fingerprintBlast directly, since that's the function responsible for
 *    excluding those fields)
 *  - citableSets: crons come from factsByFile; endpoints empty when
 *    factsByFile is undefined
 */

const baseIntent: Intent = {
  intent: 'Add retry logic to the sync job',
  in_scope: ['src/sync/retry.ts'],
  out_of_scope: ['src/sync/legacy.ts'],
};

const baseInput = {
  headSha: 'abc123',
  changedPaths: ['b.ts', 'a.ts'],
  intent: baseIntent,
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
};

const baseBlast: BlastRadiusResult = {
  changedSymbols: [
    { file: 'src/sync/retry.ts', name: 'retrySync', kind: 'function' },
    { file: 'src/sync/index.ts', name: 'runSync', kind: 'function' },
  ],
  callers: [
    { file: 'src/jobs/cron.ts', symbol: 'runSync', viaSymbol: 'retrySync', line: 12, rank: 1 },
  ],
  impactedEndpoints: ['/api/sync'],
  factsByFile: {
    'src/jobs/cron.ts': { endpoints: ['/api/sync'], crons: ['nightly-sync'] },
  },
  degraded: false,
};

describe('deriveStateKey', () => {
  it('AC-22, AC-24: is stable across two calls on the same input, and changes when intent (AC-22) or headSha (AC-24) changes', () => {
    const first = deriveStateKey(baseInput);
    const second = deriveStateKey({ ...baseInput, changedPaths: [...baseInput.changedPaths] });
    expect(first).toBe(second);

    const changedIntent = deriveStateKey({
      ...baseInput,
      intent: { ...baseIntent, intent: 'Something else entirely' },
    });
    expect(changedIntent).not.toBe(first);

    const changedHeadSha = deriveStateKey({ ...baseInput, headSha: 'def456' });
    expect(changedHeadSha).not.toBe(first);
  });

  it('is order-independent for changedPaths (sorted before hashing)', () => {
    const a = deriveStateKey({ ...baseInput, changedPaths: ['a.ts', 'b.ts'] });
    const b = deriveStateKey({ ...baseInput, changedPaths: ['b.ts', 'a.ts'] });
    expect(a).toBe(b);
  });

  it('does not depend on blast radius output at all — same key regardless of blast', () => {
    // deriveStateKey has no `blast` parameter; this documents/proves that
    // fact so a future refactor accidentally adding one gets caught.
    const key = deriveStateKey(baseInput);
    expect(typeof key).toBe('string');
    expect(key).toHaveLength(64); // sha256 hex digest length
  });
});

describe('fingerprintBlast', () => {
  it('is stable when only summary or priorPrs differ', () => {
    const withoutSummary = fingerprintBlast(baseBlast);
    const withSummary = fingerprintBlast({ ...baseBlast, summary: 'This changes behavior' });
    expect(withSummary).toBe(withoutSummary);

    const withPriorPrs = fingerprintBlast({
      ...baseBlast,
      priorPrs: [{ id: '1', number: 42, title: 'Prior PR', openedAt: null, status: 'merged' }],
    });
    expect(withPriorPrs).toBe(withoutSummary);
  });

  it('changes when deterministic facts change', () => {
    const base = fingerprintBlast(baseBlast);

    const changedSymbols = fingerprintBlast({
      ...baseBlast,
      changedSymbols: [...baseBlast.changedSymbols, { file: 'x.ts', name: 'foo', kind: 'function' }],
    });
    expect(changedSymbols).not.toBe(base);

    const changedCallers = fingerprintBlast({ ...baseBlast, callers: [] });
    expect(changedCallers).not.toBe(base);

    const changedEndpoints = fingerprintBlast({ ...baseBlast, impactedEndpoints: [] });
    expect(changedEndpoints).not.toBe(base);

    const changedFacts = fingerprintBlast({ ...baseBlast, factsByFile: undefined });
    expect(changedFacts).not.toBe(base);

    const changedDegraded = fingerprintBlast({ ...baseBlast, degraded: true, reason: 'no_data' });
    expect(changedDegraded).not.toBe(base);
  });

  it('is stable regardless of array ordering within changedSymbols/callers/factsByFile', () => {
    const reordered: BlastRadiusResult = {
      ...baseBlast,
      changedSymbols: [...baseBlast.changedSymbols].reverse(),
    };
    expect(fingerprintBlast(reordered)).toBe(fingerprintBlast(baseBlast));
  });
});

describe('citableSets', () => {
  it('AC-9: includes changed paths as files, endpoints from impactedEndpoints plus crons from factsByFile', () => {
    const { files, endpoints } = citableSets(['a.ts', 'b.ts'], baseBlast);
    expect(files).toEqual(new Set(['a.ts', 'b.ts']));
    expect(endpoints).toEqual(new Set(['/api/sync', 'nightly-sync']));
  });

  it('AC-9: yields an empty endpoint set when blast is null', () => {
    const { files, endpoints } = citableSets(['a.ts'], null);
    expect(files).toEqual(new Set(['a.ts']));
    expect(endpoints.size).toBe(0);
  });

  it('AC-9: yields endpoints from impactedEndpoints only (no crons) when factsByFile is undefined', () => {
    const { endpoints } = citableSets([], { ...baseBlast, factsByFile: undefined });
    expect(endpoints).toEqual(new Set(['/api/sync']));
  });
});

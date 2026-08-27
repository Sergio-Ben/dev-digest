import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { matches, scoreCase, aggregateBatch, type ExpectedFinding, type BatchCaseInput } from './score.js';

/** Minimal `Finding` factory — only the fields the scorer reads matter for these tests. */
function makeFinding(overrides: Partial<Finding> & Pick<Finding, 'file' | 'start_line' | 'end_line'>): Finding {
  return {
    id: `f-${Math.random().toString(36).slice(2)}`,
    severity: 'WARNING',
    category: 'bug',
    title: 'stub finding',
    rationale: 'stub rationale',
    confidence: 0.9,
    ...overrides,
  };
}

function expectedFinding(overrides: Partial<ExpectedFinding> & Pick<ExpectedFinding, 'file' | 'start_line'>): ExpectedFinding {
  return {
    severity: 'WARNING',
    category: 'bug',
    title: 'stub expected finding',
    ...overrides,
  };
}

describe('matches (AC-20)', () => {
  it('matches on same file + overlapping ranges, ignoring severity/category/title', () => {
    const expected = expectedFinding({ file: 'foo.ts', start_line: 12 }); // degenerate [12,12]
    const produced = makeFinding({ file: 'foo.ts', start_line: 10, end_line: 14, severity: 'CRITICAL', category: 'security', title: 'unrelated title' });

    expect(matches(expected, produced)).toBe(true);
  });

  it('does not match a different file, even with identical line ranges', () => {
    const expected = expectedFinding({ file: 'foo.ts', start_line: 12 });
    const produced = makeFinding({ file: 'bar.ts', start_line: 12, end_line: 12 });

    expect(matches(expected, produced)).toBe(false);
  });

  it('does not match a non-overlapping range in the same file', () => {
    const expected = expectedFinding({ file: 'foo.ts', start_line: 12 });
    const produced = makeFinding({ file: 'foo.ts', start_line: 20, end_line: 30 });

    expect(matches(expected, produced)).toBe(false);
  });

  it('matches when ranges only touch at a boundary (max(startE,startP) <= min(endE,endP))', () => {
    const expected = expectedFinding({ file: 'foo.ts', start_line: 10, end_line: 14 });
    const produced = makeFinding({ file: 'foo.ts', start_line: 14, end_line: 20 });

    expect(matches(expected, produced)).toBe(true);
  });
});

describe('scoreCase (AC-21/22/23/24/25/27)', () => {
  it('computes recall 2/3 and precision 0.8 via the overlap rule (AC-20/21/22)', () => {
    const expected: ExpectedFinding[] = [
      expectedFinding({ file: 'a.ts', start_line: 10 }), // matched by produced #1
      expectedFinding({ file: 'a.ts', start_line: 30, end_line: 35 }), // matched by produced #2
      expectedFinding({ file: 'b.ts', start_line: 5, end_line: 5 }), // NOT matched
    ];

    const produced: Finding[] = [
      makeFinding({ file: 'a.ts', start_line: 9, end_line: 11 }), // matches expected[0]
      makeFinding({ file: 'a.ts', start_line: 32, end_line: 33 }), // matches expected[1]
      makeFinding({ file: 'a.ts', start_line: 32, end_line: 34 }), // also matches expected[1] (extra true positive)
      makeFinding({ file: 'a.ts', start_line: 32, end_line: 34 }), // also matches expected[1] (extra true positive)
      makeFinding({ file: 'c.ts', start_line: 1, end_line: 2 }), // matches nothing -> noise
    ];

    const result = scoreCase(expected, produced, produced.length);

    expect(result.recall).toBeCloseTo(2 / 3, 10);
    expect(result.precision).toBeCloseTo(0.8, 10);
    expect(result.pass).toBe(false); // recall and precision are both < 1
  });

  it('computes citation_accuracy = survived/candidateCount (AC-23)', () => {
    const survived: Finding[] = Array.from({ length: 19 }, (_, i) =>
      makeFinding({ file: 'x.ts', start_line: i, end_line: i }),
    );

    const result = scoreCase([], survived, 20);

    expect(result.citation_accuracy).toBeCloseTo(0.95, 10);
  });

  it('resolves all vacuous denominators to 1.0 when a must_not_flag case produces nothing (AC-24)', () => {
    const result = scoreCase([], [], 0);

    expect(result.recall).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.citation_accuracy).toBe(1);
    expect(result.pass).toBe(true);
  });

  it('fails a must_not_flag case that produces one finding (AC-25)', () => {
    const producedNoise = [makeFinding({ file: 'x.ts', start_line: 1, end_line: 1 })];

    const result = scoreCase([], producedNoise, producedNoise.length);

    expect(result.precision).toBe(0); // the one produced finding is unmatched noise
    expect(result.recall).toBe(1); // vacuous: no expected findings to miss
    expect(result.pass).toBe(false);
  });

  it('passes a case with one expected finding matched exactly', () => {
    const expected = [expectedFinding({ file: 'x.ts', start_line: 5, end_line: 8 })];
    const produced = [makeFinding({ file: 'x.ts', start_line: 5, end_line: 8 })];

    const result = scoreCase(expected, produced, produced.length);

    expect(result.recall).toBe(1);
    expect(result.precision).toBe(1);
    expect(result.pass).toBe(true);
  });

  it('every metric stays within [0, 1] across a mixed batch of cases', () => {
    const cases: [ExpectedFinding[], Finding[], number][] = [
      [[], [], 0],
      [
        [expectedFinding({ file: 'a.ts', start_line: 1 })],
        [makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 })],
        1,
      ],
      [
        [expectedFinding({ file: 'a.ts', start_line: 1 })],
        [],
        0,
      ],
      [
        [],
        [makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 })],
        1,
      ],
    ];

    for (const [expected, produced, candidateCount] of cases) {
      const result = scoreCase(expected, produced, candidateCount);
      expect(result.recall).toBeGreaterThanOrEqual(0);
      expect(result.recall).toBeLessThanOrEqual(1);
      expect(result.precision).toBeGreaterThanOrEqual(0);
      expect(result.precision).toBeLessThanOrEqual(1);
      expect(result.citation_accuracy).toBeGreaterThanOrEqual(0);
      expect(result.citation_accuracy).toBeLessThanOrEqual(1);
    }
  });

  it('is a pure deterministic function — re-scoring identical inputs yields identical output (AC-27)', () => {
    const expected = [
      expectedFinding({ file: 'a.ts', start_line: 10 }),
      expectedFinding({ file: 'b.ts', start_line: 5, end_line: 5 }),
    ];
    const produced = [
      makeFinding({ file: 'a.ts', start_line: 9, end_line: 11 }),
      makeFinding({ file: 'c.ts', start_line: 1, end_line: 2 }),
    ];

    const first = scoreCase(expected, produced, 3);
    const second = scoreCase(expected, produced, 3);

    expect(second).toEqual(first);
  });
});

describe('aggregateBatch (AC-21/22/23/26/27/29)', () => {
  it('micro-averages recall/precision/citation across cases and reports traces_passed/total', () => {
    const passingCase = scoreCase(
      [expectedFinding({ file: 'a.ts', start_line: 1 })],
      [makeFinding({ file: 'a.ts', start_line: 1, end_line: 1 })],
      1,
    );
    const failingCase = scoreCase(
      [expectedFinding({ file: 'b.ts', start_line: 1 })],
      [],
      0,
    );
    const noiseCase = scoreCase(
      [],
      [makeFinding({ file: 'c.ts', start_line: 1, end_line: 1 })],
      1,
    );

    const perCase: BatchCaseInput[] = [
      { score: passingCase, costUsd: 0.01 },
      { score: failingCase, costUsd: 0.02 },
      { score: noiseCase, costUsd: null },
    ];

    const batch = aggregateBatch(perCase);

    // expected total = 2 (a.ts + b.ts), matched = 1 (a.ts) -> recall = 1/2
    expect(batch.recall).toBeCloseTo(0.5, 10);
    // produced total = 2 (a.ts match + c.ts noise), matched = 1 -> precision = 1/2
    expect(batch.precision).toBeCloseTo(0.5, 10);
    // survived total = 2, candidate total = 2 -> citation = 1
    expect(batch.citation_accuracy).toBe(1);
    expect(batch.traces_passed).toBe(1);
    expect(batch.traces_total).toBe(3);
    expect(batch.cost_usd).toBeCloseTo(0.03, 10); // tolerates the null cost, sums the known ones
  });

  it('reports cost_usd null when no case has a known cost, without crashing (AC-29)', () => {
    const oneCase = scoreCase([], [], 0);
    const batch = aggregateBatch([{ score: oneCase, costUsd: null }, { score: oneCase }]);

    expect(batch.cost_usd).toBeNull();
    expect(batch.traces_total).toBe(2);
  });

  it('keeps every ratio metric within [0, 1] for an empty batch', () => {
    const batch = aggregateBatch([]);

    expect(batch.recall).toBe(1);
    expect(batch.precision).toBe(1);
    expect(batch.citation_accuracy).toBe(1);
    expect(batch.traces_passed).toBe(0);
    expect(batch.traces_total).toBe(0);
    expect(batch.cost_usd).toBeNull();
  });
});

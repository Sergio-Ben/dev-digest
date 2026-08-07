import { describe, it, expect } from 'vitest';
import { classifyFile, compareFilesForReview } from '../src/modules/smart-diff/classifier.js';
import { BOILERPLATE_FILENAMES } from '../src/modules/smart-diff/constants.js';

/**
 * Smart Diff role classifier — pure, deterministic, no I/O/no LLM. Covers the
 * boilerplate → wiring → core precedence and the intra-group comparator.
 */
describe('classifyFile', () => {
  it('classifies every known lock-file basename as boilerplate (explicit acceptance criterion)', () => {
    for (const filename of BOILERPLATE_FILENAMES) {
      expect(classifyFile(filename)).toBe('boilerplate');
      expect(classifyFile(`packages/api/${filename}`)).toBe('boilerplate');
    }
  });

  it('classifies dist/index.ts as boilerplate — directory precedes the wiring basename rule', () => {
    expect(classifyFile('dist/index.ts')).toBe('boilerplate');
  });

  it('classifies distribution/service.ts as core — segment match, not substring', () => {
    expect(classifyFile('distribution/service.ts')).toBe('core');
  });

  it('classifies config/wiring files as wiring', () => {
    expect(classifyFile('src/config.ts')).toBe('wiring');
    expect(classifyFile('src/api/index.ts')).toBe('wiring');
    expect(classifyFile('next.config.mjs')).toBe('wiring');
  });

  it('classifies ordinary application logic as core', () => {
    expect(classifyFile('src/middleware/ratelimit.ts')).toBe('core');
  });

  it('classifies snapshot files as boilerplate', () => {
    expect(classifyFile('__snapshots__/foo.snap')).toBe('boilerplate');
  });
});

describe('compareFilesForReview', () => {
  it('ranks findings above size, and size above path (stable deterministic order)', () => {
    const files = [
      { path: 'b.ts', findingsCount: 0, additions: 100, deletions: 0 },
      { path: 'z.ts', findingsCount: 2, additions: 5, deletions: 0 },
      { path: 'a.ts', findingsCount: 2, additions: 10, deletions: 0 },
      { path: 'c.ts', findingsCount: 0, additions: 100, deletions: 0 },
    ];
    const sorted = [...files].sort(compareFilesForReview);
    expect(sorted.map((f) => f.path)).toEqual(['a.ts', 'z.ts', 'b.ts', 'c.ts']);
  });
});

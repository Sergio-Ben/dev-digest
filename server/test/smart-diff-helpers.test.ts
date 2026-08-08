import { describe, it, expect } from 'vitest';
import { buildSplitSuggestion, groupFiles } from '../src/modules/smart-diff/helpers.js';
import {
  SPLIT_MIN_FILES_PER_GROUP,
  SPLIT_TOO_BIG_CORE_FILES,
  SPLIT_TOO_BIG_TOTAL_LINES,
} from '../src/modules/smart-diff/constants.js';

/**
 * Pure grouping/split-suggestion logic — no DB needed, so it's covered
 * directly without going through `SmartDiffService`.
 */
describe('groupFiles', () => {
  it('groups by role in ROLE_ORDER, omits empty groups, and sorts within a group', () => {
    const groups = groupFiles([
      { path: 'pnpm-lock.yaml', additions: 500, deletions: 0, findingsCount: 0, finding_lines: [], findings: [] },
      { path: 'src/index.ts', additions: 10, deletions: 0, findingsCount: 0, finding_lines: [], findings: [] },
      {
        path: 'src/core-a.ts',
        additions: 5,
        deletions: 0,
        findingsCount: 1,
        finding_lines: [3],
        findings: [{ id: 'finding-a', line: 3 }],
      },
      { path: 'src/core-b.ts', additions: 50, deletions: 0, findingsCount: 0, finding_lines: [], findings: [] },
    ]);

    expect(groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);

    const core = groups.find((g) => g.role === 'core')!;
    // core-a has a finding → ranks first even though core-b has more lines.
    expect(core.files.map((f) => f.path)).toEqual(['src/core-a.ts', 'src/core-b.ts']);
    expect(core.files[0]!.pseudocode_summary).toBeNull();
    expect(core.files[0]!.finding_lines).toEqual([3]);
    // The identifiable form is carried through untouched — it's what the
    // client routes on when a finding badge is clicked.
    expect(core.files[0]!.findings).toEqual([{ id: 'finding-a', line: 3 }]);
  });

  it('returns an empty groups array for no files', () => {
    expect(groupFiles([])).toEqual([]);
  });
});

describe('buildSplitSuggestion', () => {
  it('is not too_big and proposes nothing for a small PR', () => {
    const result = buildSplitSuggestion([
      { path: 'src/a.ts', additions: 10, deletions: 0 },
      { path: 'src/b.ts', additions: 10, deletions: 0 },
    ]);
    expect(result).toEqual({ too_big: false, total_lines: 20, proposed_splits: [] });
  });

  it('is too_big when total lines exceed the threshold, and groups core files by prefix', () => {
    const files = [
      { path: 'src/moduleA/one.ts', additions: SPLIT_TOO_BIG_TOTAL_LINES, deletions: 0 },
      { path: 'src/moduleA/two.ts', additions: 10, deletions: 0 },
      { path: 'src/moduleB/lonely.ts', additions: 5, deletions: 0 },
    ];
    const result = buildSplitSuggestion(files);
    expect(result.too_big).toBe(true);
    expect(result.total_lines).toBe(SPLIT_TOO_BIG_TOTAL_LINES + 15);
    // moduleB has only 1 file (< SPLIT_MIN_FILES_PER_GROUP) so it's excluded.
    expect(result.proposed_splits).toEqual([
      { name: 'src/moduleA', files: ['src/moduleA/one.ts', 'src/moduleA/two.ts'] },
    ]);
    expect(result.proposed_splits[0]!.files.length).toBeGreaterThanOrEqual(
      SPLIT_MIN_FILES_PER_GROUP,
    );
  });

  it('is too_big when the core-file count exceeds the threshold even with small line counts', () => {
    const files = Array.from({ length: SPLIT_TOO_BIG_CORE_FILES + 1 }, (_, i) => ({
      path: `src/many/file-${i}.ts`,
      additions: 1,
      deletions: 0,
    }));
    const result = buildSplitSuggestion(files);
    expect(result.too_big).toBe(true);
  });
});

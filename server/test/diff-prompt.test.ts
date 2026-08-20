import { describe, it, expect } from 'vitest';
import { hunkHeader, changedFilesSection, estimateTokens } from '../src/modules/_shared/diff-prompt.js';
import type { UnifiedDiff } from '@devdigest/shared';

describe('diff-prompt', () => {
  it('hunkHeader reconstructs a @@ header line from parsed fields', () => {
    expect(hunkHeader({ oldStart: 1, oldLines: 4, newStart: 1, newLines: 7 })).toBe(
      '@@ -1,4 +1,7 @@',
    );
  });

  it('estimateTokens is ceil(chars / 4)', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('changedFilesSection renders file headers + hunk headers only, no diff body lines', () => {
    const diff: UnifiedDiff = {
      raw: '',
      files: [
        {
          path: 'src/foo.ts',
          additions: 3,
          deletions: 1,
          hunks: [
            {
              file: 'src/foo.ts',
              oldStart: 1,
              oldLines: 4,
              newStart: 1,
              newLines: 7,
              newLineNumbers: [1, 2, 3, 4, 5, 6, 7],
            },
          ],
        },
      ],
    };

    const section = changedFilesSection(diff);

    expect(section).toBe('### src/foo.ts\n@@ -1,4 +1,7 @@');
    // No source line from the diff body should ever leak in.
    for (const line of section.split('\n')) {
      expect(line.startsWith('+') || line.startsWith('-')).toBe(false);
    }
  });
});

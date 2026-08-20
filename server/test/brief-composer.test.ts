import { describe, it, expect } from 'vitest';
import type { UnifiedDiff } from '@devdigest/shared';
import { buildUserMessage, type BriefReference } from '../src/modules/brief/prompt.js';
import { composeBrief } from '../src/modules/brief/composer.js';
import { REFERENCE_BUDGET_BYTES, TRUNCATION_MARKER } from '../src/modules/brief/constants.js';
import { MockLLMProvider } from '../src/adapters/mocks.js';
import type { Logger } from '../src/modules/reviews/run-executor.js';

/**
 * brief-composer.test.ts — T6's own acceptance proof (normally T10's job,
 * written here early per T6's brief). Covers AC-1, AC-2, AC-7, AC-8, AC-10,
 * AC-43, AC-45, AC-46 for `prompt.ts` + `composer.ts`.
 */

const ALL_HEADINGS = [
  '## PR\n',
  '## PR Description\n',
  '## Diff stats\n',
  '## Changed files\n',
  '## Intent\n',
  '## Blast radius\n',
  '## Linked issue\n',
  '## Referenced plans/specs\n',
];

function buildDiff(): UnifiedDiff {
  return {
    raw:
      'diff --git a/src/foo.ts b/src/foo.ts\n' +
      '@@ -1,2 +1,3 @@\n' +
      '-const old = 1;\n' +
      '+const updated = 2;\n' +
      ' context line unchanged\n',
    files: [
      {
        path: 'src/foo.ts',
        additions: 1,
        deletions: 1,
        hunks: [
          { file: 'src/foo.ts', oldStart: 1, oldLines: 2, newStart: 1, newLines: 3, newLineNumbers: [1, 2, 3] },
        ],
      },
    ],
  };
}

function fullOpts() {
  return {
    title: 'Add foo utility',
    author: 'octocat',
    branch: 'feat/foo',
    base: 'main',
    body: 'This PR adds the foo utility to support bar.',
    diffStats: { additions: 1, deletions: 1, changedFileCount: 1 },
    diff: buildDiff(),
    intent: {
      intent: 'Add a foo utility function.',
      in_scope: ['src/foo.ts'],
      out_of_scope: ['tests'],
    },
    blast: {
      changedSymbols: [{ file: 'src/foo.ts', name: 'foo', kind: 'function' }],
      callers: [{ file: 'src/bar.ts', symbol: 'bar', viaSymbol: 'foo', line: 5, rank: 1 }],
      impactedEndpoints: ['GET /api/foo'],
      factsByFile: { 'src/foo.ts': { endpoints: ['GET /api/foo'], crons: ['nightly-foo'] } },
      summary: 'Adds a foo utility used by bar.',
    },
    issue: { title: 'Need a foo utility', body: 'We need foo for bar to work.' },
    references: [{ source: 'docs/foo.md', content: 'Foo design notes.' }] satisfies BriefReference[],
  };
}

/** Extract the body of one `## Heading` section up to the next `## ` heading (or end). */
function extractSection(message: string, heading: string): string {
  const start = message.indexOf(heading);
  if (start === -1) return '';
  const rest = message.slice(start + heading.length);
  const nextIdx = rest.indexOf('\n## ');
  return nextIdx === -1 ? rest : rest.slice(0, nextIdx);
}

describe('buildUserMessage', () => {
  it('renders exactly the eight headings when every input is present, and no others (AC-1)', () => {
    const { message, sections } = buildUserMessage(fullOpts());

    for (const heading of ALL_HEADINGS) {
      expect(message).toContain(heading.trimEnd());
    }
    // No stray ninth heading.
    const headingCount = (message.match(/^## /gm) ?? []).length;
    expect(headingCount).toBe(ALL_HEADINGS.length);
    expect(sections.present).toEqual([
      'pr',
      'pr_description',
      'diff_stats',
      'changed_files',
      'intent',
      'blast_radius',
      'linked_issue',
      'referenced_specs',
    ]);
    expect(sections.absent).toEqual([]);
  });

  it('the Changed files section contains only path/hunk-header lines, never a diff body line (AC-2)', () => {
    const { message } = buildUserMessage(fullOpts());
    const section = extractSection(message, '## Changed files\n').trim();
    const lines = section.split('\n').filter((l) => l.trim().length > 0);

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.startsWith('### ') || line.startsWith('@@ ')).toBe(true);
    }
    // None of diff.raw's added/removed/context body lines leak into this section.
    expect(section).not.toContain('const old = 1;');
    expect(section).not.toContain('const updated = 2;');
    expect(section).not.toContain('context line unchanged');
  });

  it('omits the PR Description and Referenced plans/specs headings when absent (AC-8)', () => {
    const opts = fullOpts();
    const { message, sections } = buildUserMessage({
      ...opts,
      body: null,
      references: [],
    });

    expect(message).not.toContain('## PR Description');
    expect(message).not.toContain('## Referenced plans/specs');
    expect(sections.present).not.toContain('pr_description');
    expect(sections.present).not.toContain('referenced_specs');
    expect(sections.absent).toContain('pr_description');
    expect(sections.absent).toContain('referenced_specs');
  });

  it('bounds referenced content to REFERENCE_BUDGET_BYTES and marks truncation (AC-7)', () => {
    const bigContent = 'x'.repeat(200_000); // 200 KB
    const opts = fullOpts();
    const { message } = buildUserMessage({
      ...opts,
      references: [{ source: 'docs/huge.md', content: bigContent }],
    });

    const section = extractSection(message, '## Referenced plans/specs\n');
    expect(section).toContain(TRUNCATION_MARKER);

    // The raw (unwrapped) reference content bytes must be at or under budget.
    const innerMatch = section.match(/<untrusted source="spec:docs\/huge\.md">\n([\s\S]*)\n<\/untrusted>/);
    expect(innerMatch).not.toBeNull();
    const inner = innerMatch![1]!;
    expect(Buffer.byteLength(inner, 'utf8')).toBeLessThanOrEqual(
      REFERENCE_BUDGET_BYTES + Buffer.byteLength(TRUNCATION_MARKER, 'utf8'),
    );
  });

  it('encloses every untrusted section in <untrusted source="…"> delimiters (AC-46)', () => {
    const { message } = buildUserMessage(fullOpts());

    const prSection = extractSection(message, '## PR\n');
    const descSection = extractSection(message, '## PR Description\n');
    const issueSection = extractSection(message, '## Linked issue\n');
    const refsSection = extractSection(message, '## Referenced plans/specs\n');

    for (const section of [prSection, descSection, issueSection, refsSection]) {
      expect(section).toMatch(/<untrusted source="[^"]+">/);
      expect(section).toContain('</untrusted>');
    }
  });
});

describe('composeBrief', () => {
  const briefFixture = {
    what: 'Adds a foo utility used by bar.',
    why: 'bar needs a shared implementation of foo.',
    risk_level: 'low' as const,
    risks: [
      {
        kind: 'correctness',
        title: 'Loop bound looks off',
        explanation: 'The new loop may run one iteration too many.',
        severity: 'low' as const,
        file_refs: ['src/foo.ts:12'],
        endpoint_refs: [] as string[],
      },
    ],
    review_focus: [{ file: 'src/foo.ts', line: 12, reason: 'Check the new loop bound.' }],
  };

  function makeCapturingLogger(): { logger: Logger; entries: { obj: unknown; msg?: string }[] } {
    const entries: { obj: unknown; msg?: string }[] = [];
    const logger: Logger = {
      info: (obj, msg) => entries.push({ obj, msg }),
      warn: () => {},
      error: () => {},
      debug: () => {},
    };
    return { logger, entries };
  }

  it('makes exactly one completeStructured call and logs sections/provider/model + both token estimates (AC-10, AC-43, AC-45)', async () => {
    const llm = new MockLLMProvider('openai', { structured: briefFixture });
    const { logger, entries } = makeCapturingLogger();

    const result = await composeBrief({
      ...fullOpts(),
      llm,
      model: 'gpt-4.1',
      provider: 'openai',
      logger,
    });

    // AC-10: exactly one structured call.
    const structuredCalls = llm.calls.filter((c) => c.method === 'completeStructured');
    expect(structuredCalls).toHaveLength(1);
    expect(llm.calls).toHaveLength(1);

    expect(result.raw).toEqual(briefFixture);

    // AC-43: a log line names present/absent sections plus provider/model.
    const sectionsLog = entries.find(
      (e) =>
        typeof e.obj === 'object' &&
        e.obj !== null &&
        'sections' in (e.obj as Record<string, unknown>),
    );
    expect(sectionsLog).toBeDefined();
    const sectionsObj = sectionsLog!.obj as {
      provider: string;
      model: string;
      sections: { present: string[]; absent: string[] };
    };
    expect(sectionsObj.provider).toBe('openai');
    expect(sectionsObj.model).toBe('gpt-4.1');
    expect(sectionsObj.sections.present).toContain('pr');
    expect(sectionsObj.sections.absent).toEqual([]);

    // AC-45: both header-only and full-diff token estimates are logged.
    const tokensLog = entries.find(
      (e) =>
        typeof e.obj === 'object' &&
        e.obj !== null &&
        'headerOnlyTokens' in (e.obj as Record<string, unknown>),
    );
    expect(tokensLog).toBeDefined();
    const tokensObj = tokensLog!.obj as {
      fullDiffTokens: number;
      headerOnlyTokens: number;
      savedTokens: number;
    };
    expect(typeof tokensObj.fullDiffTokens).toBe('number');
    expect(typeof tokensObj.headerOnlyTokens).toBe('number');
    expect(tokensObj.savedTokens).toBe(tokensObj.fullDiffTokens - tokensObj.headerOnlyTokens);

    expect(result.tokens.fullDiff).toBe(tokensObj.fullDiffTokens);
    expect(result.tokens.headerOnly).toBe(tokensObj.headerOnlyTokens);
    expect(result.tokens.saved).toBe(tokensObj.savedTokens);
  });
});

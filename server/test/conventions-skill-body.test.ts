import { describe, it, expect } from 'vitest';
import type { ConventionCandidate } from '@devdigest/shared';
import { buildSkillDraft } from '../src/modules/conventions/skill-body.js';

const base: ConventionCandidate = {
  id: '00000000-0000-0000-0000-000000000001',
  category: 'async-await-then-chains',
  rule: 'Always use async/await instead of .then() chains.',
  evidencePath: 'src/api/users.ts',
  evidenceSnippet: 'const user = await db.users.find(id);',
  evidenceStartLine: 23,
  evidenceEndLine: 31,
  confidence: 0.92,
  status: 'accepted',
  skillId: null,
};

const candidate = (patch: Partial<ConventionCandidate>): ConventionCandidate => ({
  ...base,
  ...patch,
});

describe('buildSkillDraft', () => {
  it('names the skill after the repo, lower-kebab', () => {
    const draft = buildSkillDraft('Payments API', [base]);
    expect(draft.name).toBe('payments-api-conventions');
  });

  it('pluralises the description', () => {
    expect(buildSkillDraft('payments-api', [base]).description).toBe(
      '1 house convention extracted from payments-api',
    );
    expect(
      buildSkillDraft('payments-api', [base, candidate({ id: 'x' })]).description,
    ).toBe('2 house conventions extracted from payments-api');
  });

  it('renders one section per candidate with location and fenced snippet', () => {
    const draft = buildSkillDraft('payments-api', [base]);
    expect(draft.body).toContain('# payments-api-conventions');
    expect(draft.body).toContain('## async-await-then-chains');
    expect(draft.body).toContain('Always use async/await instead of .then() chains.');
    expect(draft.body).toContain('Detected in `src/api/users.ts:23-31`:');
    expect(draft.body).toContain('```ts\nconst user = await db.users.find(id);\n```');
  });

  it('infers the fence language from the file extension', () => {
    const py = buildSkillDraft('r', [candidate({ evidencePath: 'app/main.py' })]);
    expect(py.body).toContain('```python');
    const unknown = buildSkillDraft('r', [candidate({ evidencePath: 'Makefile' })]);
    expect(unknown.body).toContain('```\nconst user');
  });

  it('collapses a single-line range and omits an unknown one', () => {
    const single = buildSkillDraft('r', [
      candidate({ evidenceStartLine: 7, evidenceEndLine: 7 }),
    ]);
    expect(single.body).toContain('Detected in `src/api/users.ts:7`:');

    const none = buildSkillDraft('r', [
      candidate({ evidenceStartLine: null, evidenceEndLine: null }),
    ]);
    expect(none.body).toContain('Detected in `src/api/users.ts`:');
  });

  it('suffixes colliding headings instead of emitting duplicates', () => {
    const draft = buildSkillDraft('r', [
      base,
      candidate({ id: 'b', rule: 'Another rule.' }),
      candidate({ id: 'c', rule: 'Third rule.' }),
    ]);
    expect(draft.body).toContain('## async-await-then-chains\n');
    expect(draft.body).toContain('## async-await-then-chains-2\n');
    expect(draft.body).toContain('## async-await-then-chains-3\n');
  });

  it('falls back to the rule slug when the model gave no category', () => {
    const draft = buildSkillDraft('r', [candidate({ category: null })]);
    expect(draft.body).toContain('## always-use-async-await-instead-of-then-chains');
  });

  it('dedupes evidence_files, preserving candidate order', () => {
    const draft = buildSkillDraft('r', [
      base,
      candidate({ id: 'b', evidencePath: 'src/db.ts' }),
      candidate({ id: 'c', evidencePath: 'src/api/users.ts' }),
    ]);
    expect(draft.evidence_files).toEqual(['src/api/users.ts', 'src/db.ts']);
  });

  it('renders a stable document for a two-candidate scan', () => {
    const draft = buildSkillDraft('payments-api', [
      base,
      candidate({
        id: 'b',
        category: 'named-exports',
        rule: 'Export named functions, never a default export.',
        evidencePath: 'src/db.ts',
        evidenceSnippet: 'export const db = drizzle(pool);',
        evidenceStartLine: 4,
        evidenceEndLine: 4,
      }),
    ]);
    expect(draft.body).toMatchInlineSnapshot(`
      "# payments-api-conventions

      House conventions for \`payments-api\`. Flag changes that violate any rule below and cite
      the offending \`file:line\`.

      ## async-await-then-chains
      Always use async/await instead of .then() chains.

      Detected in \`src/api/users.ts:23-31\`:

      \`\`\`ts
      const user = await db.users.find(id);
      \`\`\`

      ## named-exports
      Export named functions, never a default export.

      Detected in \`src/db.ts:4\`:

      \`\`\`ts
      export const db = drizzle(pool);
      \`\`\`"
    `);
  });

  it('handles an empty accepted set without crashing', () => {
    const draft = buildSkillDraft('payments-api', []);
    expect(draft.evidence_files).toEqual([]);
    expect(draft.description).toBe('0 house conventions extracted from payments-api');
  });
});

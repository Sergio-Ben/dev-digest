import type { ConventionCandidate, ConventionSkillDraft } from '@devdigest/shared';

/**
 * Candidates → skill draft (name / description / markdown body) — PURE.
 *
 * The draft is generated ONCE, server-side, then handed to the modal where the
 * user can rewrite any of it. The server never regenerates from the candidates
 * afterwards: whatever the user submits is what gets saved.
 */

/** Fence language per file extension; unknown extensions get a bare fence. */
const FENCE_BY_EXT: Record<string, string> = {
  ts: 'ts',
  tsx: 'tsx',
  js: 'js',
  jsx: 'jsx',
  mjs: 'js',
  cjs: 'js',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  php: 'php',
  cs: 'csharp',
  css: 'css',
  scss: 'scss',
  html: 'html',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  sh: 'bash',
};

export function buildSkillDraft(
  repoName: string,
  accepted: ConventionCandidate[],
): ConventionSkillDraft {
  const slugRepo = slug(repoName) || 'repo';
  const name = `${slugRepo}-conventions`;
  const description = `${accepted.length} house ${
    accepted.length === 1 ? 'convention' : 'conventions'
  } extracted from ${repoName}`;

  const used = new Set<string>();
  const sections = accepted.map((c) => {
    // Category first (that's the short topical heading in the design —
    // `async-await-then-chains`); the rule slug is the fallback when the model
    // gave no category.
    const heading = uniqueSlug(slug(c.category ?? '') || slug(c.rule) || 'convention', used);
    const range = formatRange(c.evidence_start_line, c.evidence_end_line);
    const location = range ? `${c.evidence_path}:${range}` : c.evidence_path;
    const fence = FENCE_BY_EXT[extOf(c.evidence_path)] ?? '';
    return [
      `## ${heading}`,
      c.rule,
      '',
      `Detected in \`${location}\`:`,
      '',
      `\`\`\`${fence}`,
      c.evidence_snippet.replace(/\s+$/, ''),
      '```',
    ].join('\n');
  });

  const body = [
    `# ${name}`,
    '',
    `House conventions for \`${repoName}\`. Flag changes that violate any rule below and cite`,
    'the offending `file:line`.',
    '',
    ...sections.map((s) => `${s}\n`),
  ]
    .join('\n')
    .trimEnd();

  return {
    name,
    description,
    body,
    evidence_files: uniqueInOrder(accepted.map((c) => c.evidence_path)),
  };
}

// ---- private helpers -------------------------------------------------------

/** Lower-kebab: strip punctuation, collapse whitespace, trim dashes. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `foo`, then `foo-2`, `foo-3` … on collision. */
function uniqueSlug(base: string, used: Set<string>): string {
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}-${n++}`;
  used.add(candidate);
  return candidate;
}

function formatRange(start: number | null, end: number | null): string | null {
  if (start === null) return null;
  if (end === null || end === start) return String(start);
  return `${start}-${end}`;
}

function extOf(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

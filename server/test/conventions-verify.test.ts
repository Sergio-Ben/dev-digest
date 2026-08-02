import { describe, it, expect } from 'vitest';
import { verifyEvidence } from '../src/modules/conventions/verify.js';

/**
 * Evidence verification is the feature's trust boundary: it is the only thing
 * standing between a hallucinated snippet and a "convention" the user is asked
 * to accept. Pure — no DB, no model.
 */

const FILE = [
  'import { db } from "./db";',
  '',
  'export async function getUser(id: string) {',
  '  const user = await db.users.find(id);',
  '  if (!user) throw new NotFoundError("User not found");',
  '  return user;',
  '}',
].join('\n');

describe('verifyEvidence', () => {
  it('matches an exact multi-line snippet and returns the 1-based range', () => {
    const r = verifyEvidence(
      '  const user = await db.users.find(id);\n  if (!user) throw new NotFoundError("User not found");',
      FILE,
    );
    expect(r.ok).toBe(true);
    expect(r.startLine).toBe(4);
    expect(r.endLine).toBe(5);
  });

  it('tolerates indentation drift from the model', () => {
    const r = verifyEvidence(
      'const user = await db.users.find(id);\n        if (!user) throw new NotFoundError("User not found");',
      FILE,
    );
    expect(r.ok).toBe(true);
    expect(r.startLine).toBe(4);
    expect(r.endLine).toBe(5);
  });

  it('ignores blank padding around the snippet', () => {
    const r = verifyEvidence('\n\nreturn user;\n\n', FILE);
    expect(r).toMatchObject({ ok: true, startLine: 6, endLine: 6 });
  });

  it('drops a snippet that is not in the file', () => {
    const r = verifyEvidence('const user = await db.users.findOrFail(id);', FILE);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('snippet_not_found');
  });

  it('drops a candidate whose file was never sampled', () => {
    const r = verifyEvidence('return user;', null);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('file_missing');
  });

  it('does NOT accept a substring of a line — that is how fragments sneak in', () => {
    const r = verifyEvidence('await db.users.find', FILE);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('snippet_not_found');
  });

  it('accepts a whole single line', () => {
    expect(verifyEvidence('return user;', FILE)).toMatchObject({
      ok: true,
      startLine: 6,
      endLine: 6,
    });
  });

  it('returns the FIRST occurrence of a repeated snippet', () => {
    const dup = 'a();\nb();\nc();\na();\nb();';
    expect(verifyEvidence('a();\nb();', dup)).toMatchObject({
      ok: true,
      startLine: 1,
      endLine: 2,
    });
  });

  it('rejects an empty snippet instead of matching everything', () => {
    expect(verifyEvidence('   \n\n', FILE)).toMatchObject({
      ok: false,
      reason: 'empty_snippet',
    });
  });

  it('rejects a snippet longer than the file', () => {
    expect(verifyEvidence(`${FILE}\nextra();`, FILE).ok).toBe(false);
  });

  it('normalises CRLF line endings on both sides', () => {
    const crlf = FILE.replace(/\n/g, '\r\n');
    expect(verifyEvidence('return user;\r\n', crlf)).toMatchObject({
      ok: true,
      startLine: 6,
    });
  });
});

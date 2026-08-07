/**
 * Evidence verification — PURE, no I/O.
 *
 * The model is asked to copy a snippet literally out of a sampled file, but a
 * model will happily paraphrase or invent one. Every candidate is therefore
 * re-checked against the sampled contents before it is persisted: the snippet
 * must actually occur in the file, and the line range we show the user is
 * RECOMPUTED from the real match rather than trusted from the model.
 */

export interface VerifyResult {
  ok: boolean;
  /** 1-based, inclusive — only set when `ok`. */
  startLine?: number;
  endLine?: number;
  reason?: 'file_missing' | 'empty_snippet' | 'snippet_not_found';
}

/**
 * Locate `snippet` inside `fileContent`.
 *
 * Comparison is on trimmed lines: the model commonly re-indents what it copies,
 * and indentation drift shouldn't kill a genuine match. Matching stays
 * line-oriented — a single-line snippet must equal a whole trimmed line, never
 * a substring, because substring matching is exactly how a hallucinated
 * fragment ("await db.users") sneaks past the check.
 */
export function verifyEvidence(
  snippet: string,
  fileContent: string | null,
): VerifyResult {
  if (fileContent === null) return { ok: false, reason: 'file_missing' };

  const needle = trimBlankEdges(toTrimmedLines(snippet));
  if (needle.length === 0) return { ok: false, reason: 'empty_snippet' };

  const haystack = toTrimmedLines(fileContent);
  if (needle.length > haystack.length) return { ok: false, reason: 'snippet_not_found' };

  for (let i = 0; i <= haystack.length - needle.length; i++) {
    let hit = true;
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) {
        hit = false;
        break;
      }
    }
    // First match wins — a repeated snippet is ambiguous anyway, and the first
    // occurrence is the one a reader scrolling the file finds too.
    if (hit) return { ok: true, startLine: i + 1, endLine: i + needle.length };
  }

  return { ok: false, reason: 'snippet_not_found' };
}

function toTrimmedLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n').map((l) => l.trim());
}

/** Drop leading/trailing blank lines (fenced snippets arrive padded). */
function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start] === '') start++;
  while (end > start && lines[end - 1] === '') end--;
  return lines.slice(start, end);
}

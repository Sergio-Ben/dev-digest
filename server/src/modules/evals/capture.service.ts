import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { EvalCase } from '@devdigest/shared';
import { toEvalCaseDto } from './helpers.js';

/**
 * T5 — capture-a-case-from-a-finding (Capability A). Turns a DECIDED review
 * finding into a frozen `eval_cases` row:
 *   - accepted  → `must_find`      → `expected_output` = [that finding's skeleton]      (AC-2)
 *   - dismissed → `must_not_flag`  → `expected_output` = []                              (AC-3)
 *   - undecided → nothing is created; caller is told to decide first                     (AC-4)
 *
 * The frozen `input_diff` (AC-5) is the REAL code the finding was made on, sliced from the
 * source PR's stored diff (`pr_files.patch`) for the finding's file + line range. Freezing
 * the actual changed lines — rather than a location-only placeholder — is what makes the
 * case RUNNABLE: a later eval run hands the agent genuine code to review, so a `must_find`
 * case can actually be re-found (a placeholder yields 0 findings → recall 0). The slice is a
 * self-contained fragment that never references the finding/review/PR id, so the case stays
 * valid and runnable after the source is deleted (AC-6). When the source patch is
 * unavailable (e.g. the PR's files were never persisted), it falls back to a synthetic
 * location-only stub so capture still succeeds.
 *
 * Capture is IDEMPOTENT per source finding: the created case records the source finding's
 * id in `input_meta.source_finding_id`, and a repeat capture of the same finding returns
 * the EXISTING case instead of inserting a duplicate. This is what keeps a page reload (the
 * client's "created" state is ephemeral and lost on reload) from letting the same finding be
 * turned into two cases. Storing the id is provenance only — there is no FK, so it does not
 * violate AC-6 (the case still survives deletion of its source finding).
 */

export type CaptureCaseResult =
  | { created: true; case: EvalCase }
  | { created: false; reason: 'exists'; case: EvalCase }
  | { created: false; reason: 'undecided'; message: string };

export class CaptureService {
  constructor(private container: Container) {}

  async createCaseFromFinding(workspaceId: string, findingId: string): Promise<CaptureCaseResult> {
    const ctx = await this.container.reviewRepo.findingContext(findingId);
    if (!ctx || ctx.pull.workspaceId !== workspaceId) {
      throw new NotFoundError('Finding not found');
    }
    const { finding, review } = ctx;

    // AC-40: `reviews.agent_id` carries no FK — verify the owning agent
    // actually belongs to the caller's workspace rather than trusting the
    // PR's workspace alone.
    if (!review.agentId) throw new NotFoundError('Finding not found');
    const agent = await this.container.agentsRepo.getById(workspaceId, review.agentId);
    if (!agent) throw new NotFoundError('Finding not found');

    if (!finding.acceptedAt && !finding.dismissedAt) {
      return {
        created: false,
        reason: 'undecided',
        message: 'Accept or dismiss this finding before turning it into an eval case.',
      };
    }

    // Freeze the REAL code the finding was made on, sliced from the source
    // PR's stored diff (`pr_files.patch`), so a later eval run hands the agent
    // the actual changed lines — not a location-only placeholder it can't
    // review. Falls back to the synthetic placeholder only when the source
    // patch is unavailable (e.g. the PR's files were never persisted), so the
    // case is still runnable/valid after the source is deleted (AC-5, AC-6).
    const prFiles = await this.container.reviewRepo.getPrFiles(ctx.pull.id);
    const filePatch = prFiles.find((f) => f.path === finding.file)?.patch ?? null;

    const isAccepted = !!finding.acceptedAt;
    const expectation = isAccepted ? 'must_find' : 'must_not_flag';
    const lineLabel =
      finding.endLine !== finding.startLine
        ? `${finding.startLine}-${finding.endLine}`
        : `${finding.startLine}`;

    const name = `${finding.title} (${finding.file}:${lineLabel})`;

    // Idempotency: return the EXISTING case instead of inserting a duplicate
    // when this finding was already captured. The finding's own id is NOT a
    // stable key — every re-run of the agent regenerates findings with fresh
    // ids, so keying on it would let the same logical finding be captured once
    // per run. We match on the DERIVED IDENTITY the user actually sees — the
    // owning agent + the case name (title + file:line) — which is deterministic
    // from the finding and stable across reloads AND re-runs. `source_finding_id`
    // is still recorded (provenance) and also accepted as a match so cases
    // captured by the earlier id-only version keep deduping.
    const existing = await this.container.evalsRepo.listCasesForOwner(
      workspaceId,
      'agent',
      review.agentId,
    );
    const already = existing.find((c) => {
      if (c.name === name) return true;
      const meta = c.inputMeta as { source_finding_id?: string } | null;
      return meta?.source_finding_id === findingId;
    });
    if (already) {
      return { created: false, reason: 'exists', case: toEvalCaseDto(already) };
    }

    const expectedOutput = isAccepted
      ? [
          {
            severity: finding.severity,
            category: finding.category,
            title: finding.title,
            file: finding.file,
            start_line: finding.startLine,
            end_line: finding.endLine,
          },
        ]
      : [];

    const row = await this.container.evalsRepo.createCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: review.agentId,
      name,
      inputDiff:
        buildRealDiff(finding.file, finding.startLine, finding.endLine, filePatch) ??
        buildSyntheticDiff(finding.file, finding.startLine, finding.endLine),
      // Discriminator + frozen file/line snapshot for display (AC-3's "must NOT
      // comment on Y" UI needs this even though expected_output is empty).
      // `source_finding_id` is the idempotency key read above — provenance only,
      // no FK, so the case still outlives deletion of its source (AC-6).
      inputMeta: {
        expectation,
        source_finding_id: findingId,
        file: finding.file,
        start_line: finding.startLine,
        end_line: finding.endLine,
      },
      expectedOutput,
      notes: isAccepted ? null : `Must NOT comment on ${finding.file}:${lineLabel}`,
    });

    return { created: true, case: toEvalCaseDto(row) };
  }
}

/**
 * Build a minimal synthetic unified-diff fragment that `parseUnifiedDiff`
 * (`server/src/adapters/git/diff-parser.ts`) turns into a `UnifiedDiff` whose
 * one file is `file` and whose one hunk's `newLineNumbers` cover
 * `[startLine..endLine]` — exactly what the grounding gate checks against
 * when the case is later run through the real engine (T6). Only the file
 * path + line numbers need to be real; the line content is a placeholder,
 * since this is a frozen SNAPSHOT independent of the live PR (AC-5, AC-6).
 */
/**
 * Slice the REAL code lines `[startLine..endLine]` out of the source PR's
 * stored `pr_files.patch` and re-emit them as a self-contained unified-diff
 * fragment for `file`. This is what makes an eval case actually RUNNABLE: the
 * later engine run hands the agent the genuine changed code at those lines
 * instead of `// eval case snapshot line N` filler it can't review.
 *
 * We walk the raw patch tracking the new-side line cursor (same accounting as
 * `parseUnifiedDiff`): `+` and context lines advance it and carry content; `-`
 * lines don't consume a new-side line. Lines whose new-side number falls in
 * `[start..end]` are collected (verbatim content, `+`-prefixed) into one hunk
 * numbered at `start`. Returns `null` when `patch` is missing or the range
 * covers no new-side lines, so the caller can fall back to the synthetic stub.
 */
function buildRealDiff(
  file: string,
  startLine: number,
  endLine: number,
  patch: string | null,
): string | null {
  if (!patch) return null;
  const start = Math.min(startLine, endLine);
  const end = Math.max(startLine, endLine);

  const collected: string[] = [];
  let newCursor = 0;
  for (const line of patch.split('\n')) {
    const hh = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hh) {
      newCursor = Number(hh[1]);
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) continue; // deletion: no new-side line
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('diff --git'))
      continue;
    // `+` addition or context line — occupies new-side line `newCursor`.
    const isAddOrContext = line.startsWith('+') || line.startsWith(' ') || line === '';
    if (!isAddOrContext) continue;
    if (newCursor >= start && newCursor <= end) {
      const content = line.startsWith('+') || line.startsWith(' ') ? line.slice(1) : line;
      collected.push(`+${content}`);
    }
    newCursor++;
  }

  if (collected.length === 0) return null;
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${start},${collected.length} +${start},${collected.length} @@`,
    collected.join('\n'),
  ].join('\n');
}

function buildSyntheticDiff(file: string, startLine: number, endLine: number): string {
  const start = Math.min(startLine, endLine);
  const end = Math.max(startLine, endLine);
  const lineCount = end - start + 1;
  const body = Array.from(
    { length: lineCount },
    (_, i) => `+// eval case snapshot line ${start + i}`,
  ).join('\n');
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${start},${lineCount} +${start},${lineCount} @@`,
    body,
  ].join('\n');
}

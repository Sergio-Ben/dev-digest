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
 * The frozen `input_diff` is a SYNTHETIC unified-diff fragment (AC-5) built only from the
 * finding's file + line range — it never references the finding/review/PR id, so the case
 * stays valid and runnable after the source is deleted (AC-6).
 */

export type CaptureCaseResult =
  | { created: true; case: EvalCase }
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

    const isAccepted = !!finding.acceptedAt;
    const expectation = isAccepted ? 'must_find' : 'must_not_flag';
    const lineLabel =
      finding.endLine !== finding.startLine
        ? `${finding.startLine}-${finding.endLine}`
        : `${finding.startLine}`;

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
      name: `${finding.title} (${finding.file}:${lineLabel})`,
      inputDiff: buildSyntheticDiff(finding.file, finding.startLine, finding.endLine),
      // Discriminator + frozen file/line snapshot for display (AC-3's "must NOT
      // comment on Y" UI needs this even though expected_output is empty).
      inputMeta: {
        expectation,
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

/**
 * Smart Diff — application service.
 *
 * Purely LOCAL and DETERMINISTIC: this feature makes NO LLM call and does NOT
 * re-fetch from GitHub. It only reads what's already persisted (`pr_files`
 * from the last `GET /pulls/:id` sync, plus the PR's latest review +
 * findings) and derives the response with pure functions from `helpers.ts`
 * and `classifier.ts`. That's an explicit acceptance criterion — Smart Diff
 * must work fully offline and cost nothing to compute.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { SmartDiff, SmartDiffFinding } from '@devdigest/shared';
import * as t from '../../db/schema.js';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { buildSplitSuggestion, groupFiles, type SmartDiffFileInput } from './helpers.js';

export class SmartDiffService {
  constructor(private container: Container) {}

  async build(workspaceId: string, prId: string): Promise<SmartDiff> {
    const { db } = this.container;

    const [pr] = await db
      .select()
      .from(t.pullRequests)
      .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
    if (!pr) throw new NotFoundError('Pull request not found');

    const files = await db.select().from(t.prFiles).where(eq(t.prFiles.prId, pr.id));

    // Latest review of kind 'review' for this PR — if there's never been one,
    // findings stay empty and every file's `finding_lines` is `[]`; the
    // endpoint must still succeed.
    const [latestReview] = await db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(
        and(
          eq(t.reviews.workspaceId, workspaceId),
          eq(t.reviews.prId, pr.id),
          eq(t.reviews.kind, 'review'),
        ),
      )
      .orderBy(desc(t.reviews.createdAt))
      .limit(1);

    const findingRows = latestReview
      ? await db
          .select({
            id: t.findings.id,
            file: t.findings.file,
            startLine: t.findings.startLine,
            endLine: t.findings.endLine,
          })
          .from(t.findings)
          .where(eq(t.findings.reviewId, latestReview.id))
      : [];

    // file path -> ONE entry per finding, at that finding's ANCHOR line, and
    // carrying the finding's ID so the client can route a badge click to that
    // finding's card in the Agent-runs tab.
    //
    // Deliberately NOT the expanded `start_line..end_line` span, and
    // deliberately NOT deduped:
    //  - one-entry-per-finding keeps `finding_lines.length` an exact finding
    //    COUNT, which is what the UI's "N findings" badge renders (expanding
    //    spans made a single 5-line finding read as "5 findings");
    //  - anchoring at `start_line` matches the design, which flags individual
    //    lines rather than shading whole ranges, and gives the badge's
    //    click-to-jump an unambiguous target (`finding_lines[0]`).
    // The client Set-ifies this list for highlighting, so repeats are safe.
    const findingsByFile = new Map<string, SmartDiffFinding[]>();
    for (const f of findingRows) {
      // A malformed row can have start > end; the anchor is the lower bound.
      const anchor = Math.min(f.startLine, f.endLine);
      const list = findingsByFile.get(f.file);
      if (list) list.push({ id: f.id, line: anchor });
      else findingsByFile.set(f.file, [{ id: f.id, line: anchor }]);
    }

    const fileInputs: SmartDiffFileInput[] = files.map((f) => {
      // `findings` and `finding_lines` are the SAME list in the SAME order —
      // sort once, then project, or the two would disagree index-for-index.
      const sorted = [...(findingsByFile.get(f.path) ?? [])].sort((a, b) => a.line - b.line);
      return {
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
        findingsCount: sorted.length,
        finding_lines: sorted.map((x) => x.line),
        findings: sorted,
      };
    });

    return {
      groups: groupFiles(fileInputs),
      split_suggestion: buildSplitSuggestion(files.map((f) => ({
        path: f.path,
        additions: f.additions,
        deletions: f.deletions,
      }))),
    };
  }
}

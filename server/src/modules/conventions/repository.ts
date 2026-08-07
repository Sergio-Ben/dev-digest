import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';
import { normaliseRule } from './helpers.js';

/** Dedupe key for "the model already showed us this exact code". */
function evidenceKey(path: string, snippet: string): string {
  return `${path}::${snippet.replace(/\s+/g, ' ').trim()}`;
}

export type { ConventionRow, ConventionScanRow };

export interface InsertScan {
  workspaceId: string;
  repoId: string;
  sampleCount: number;
  candidateCount: number;
  droppedCount: number;
  provider: string;
  model: string;
  tokensIn?: number | null;
  tokensOut?: number | null;
  costUsd?: number | null;
}

export interface InsertCandidate {
  category: string | null;
  rule: string;
  evidencePath: string;
  evidenceSnippet: string;
  evidenceStartLine: number;
  evidenceEndLine: number;
  confidence: number;
}

export interface UpdateCandidate {
  rule?: string;
  category?: string | null;
  status?: 'pending' | 'accepted' | 'rejected';
}

/**
 * Conventions data-access. Owns `conventions` + `convention_scans`.
 * Workspace-scoped on every query.
 */
export interface ConventionRepoRef {
  owner: string;
  name: string;
  fullName: string;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  /**
   * Workspace-scoped repo lookup. `reviewRepo.getRepo` takes only a repoId, so
   * this module keeps its own scoped variant rather than leak across tenants.
   */
  async getRepo(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionRepoRef | undefined> {
    const [row] = await this.db
      .select({
        owner: t.repos.owner,
        name: t.repos.name,
        fullName: t.repos.fullName,
      })
      .from(t.repos)
      .where(and(eq(t.repos.workspaceId, workspaceId), eq(t.repos.id, repoId)));
    return row;
  }

  async listByRepo(workspaceId: string, repoId: string): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.repoId, repoId)),
      )
      .orderBy(asc(t.conventions.status), desc(t.conventions.confidence));
  }

  async latestScan(
    workspaceId: string,
    repoId: string,
  ): Promise<ConventionScanRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventionScans)
      .where(
        and(
          eq(t.conventionScans.workspaceId, workspaceId),
          eq(t.conventionScans.repoId, repoId),
        ),
      )
      .orderBy(desc(t.conventionScans.createdAt))
      .limit(1);
    return row;
  }

  async insertScan(values: InsertScan): Promise<ConventionScanRow> {
    const [row] = await this.db
      .insert(t.conventionScans)
      .values({
        workspaceId: values.workspaceId,
        repoId: values.repoId,
        sampleCount: values.sampleCount,
        candidateCount: values.candidateCount,
        droppedCount: values.droppedCount,
        provider: values.provider,
        model: values.model,
        tokensIn: values.tokensIn ?? null,
        tokensOut: values.tokensOut ?? null,
        costUsd: values.costUsd ?? null,
      })
      .returning();
    return row!;
  }

  /**
   * Swap in a fresh set of pending candidates.
   *
   * Only `pending` rows are deleted: a rule the user already accepted stays
   * accepted, and — more importantly — a rule they REJECTED must not come back
   * on every scan.
   *
   * An incoming candidate is skipped when a surviving row has the same rule OR
   * the same evidence (path + snippet). The evidence half matters: the user can
   * EDIT a rule's text, and matching on rule alone would then let the model's
   * original wording return as a fresh pending duplicate of a row they already
   * triaged.
   */
  async replacePending(
    workspaceId: string,
    repoId: string,
    scanId: string,
    candidates: InsertCandidate[],
  ): Promise<ConventionRow[]> {
    await this.db
      .delete(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          eq(t.conventions.status, 'pending'),
        ),
      );

    const survivors = await this.listByRepo(workspaceId, repoId);
    const knownRules = new Set(survivors.map((r) => normaliseRule(r.rule)));
    const knownEvidence = new Set(
      survivors.map((r) => evidenceKey(r.evidencePath ?? '', r.evidenceSnippet ?? '')),
    );

    const fresh = candidates.filter((c) => {
      const rule = normaliseRule(c.rule);
      const evidence = evidenceKey(c.evidencePath, c.evidenceSnippet);
      if (knownRules.has(rule) || knownEvidence.has(evidence)) return false;
      knownRules.add(rule);
      knownEvidence.add(evidence);
      return true;
    });
    if (fresh.length === 0) return [];

    return this.db
      .insert(t.conventions)
      .values(
        fresh.map((c) => ({
          workspaceId,
          repoId,
          scanId,
          category: c.category,
          rule: c.rule,
          evidencePath: c.evidencePath,
          evidenceSnippet: c.evidenceSnippet,
          evidenceStartLine: c.evidenceStartLine,
          evidenceEndLine: c.evidenceEndLine,
          confidence: c.confidence,
          status: 'pending' as const,
        })),
      )
      .returning();
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateCandidate,
  ): Promise<ConventionRow | undefined> {
    const set = {
      ...(patch.rule !== undefined ? { rule: patch.rule } : {}),
      ...(patch.category !== undefined ? { category: patch.category } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    };
    if (Object.keys(set).length === 0) return this.getById(workspaceId, id);

    const [row] = await this.db
      .update(t.conventions)
      .set(set)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  /** Stamp the skill a set of candidates was rolled into. */
  async markLinked(workspaceId: string, ids: string[], skillId: string): Promise<void> {
    if (ids.length === 0) return;
    await this.db
      .update(t.conventions)
      .set({ skillId })
      .where(
        and(eq(t.conventions.workspaceId, workspaceId), inArray(t.conventions.id, ids)),
      );
  }
}

import { and, desc, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalOwnerKind } from '@devdigest/shared';
import { groupRunsIntoBatches } from './helpers.js';

/**
 * T4 — evals data-access. Owns `eval_cases` and `eval_runs`. This is the ONLY
 * file in the `evals` module allowed to import `db/schema` + `drizzle-orm`
 * (onion rule) — services/routes call through this repository, never touch
 * the tables directly.
 *
 * `eval_cases` carries `workspace_id` and is scoped directly. `eval_runs` has
 * NO `workspace_id` of its own — it is scoped TRANSITIVELY by joining to its
 * parent `eval_cases` row. `insertRun` trusts the given `caseId` as-is; the
 * CALLER (a service, e.g. T5's capture path) is responsible for resolving/
 * verifying that case under the workspace (via `getCase`) BEFORE calling
 * `insertRun` — this repository does not re-check ownership on write.
 *
 * "Batches" (one execution of an agent version across all its eval cases) are
 * not a separate table — they are `eval_runs` sharing the same `batch_id`,
 * scoped to cases owned by that agent (`eval_cases.owner_kind = 'agent' AND
 * eval_cases.owner_id = agentId`). `listBatches`/`latestBatchPerAgent` fetch
 * the RAW per-case rows for that join (`listRunRowsForAgent`/
 * `listRunRowsForWorkspace`) and hand them to `helpers.ts#groupRunsIntoBatches`,
 * which MICRO-averages each batch via reviewer-core's `aggregateBatch` (fix
 * for a prior SQL `avg()` MACRO-average bug — see server/INSIGHTS.md "T16
 * macro-vs-micro" entry), returning `EvalBatchAggregateRow` (repository-level
 * shape); mapping that to the public `EvalBatchRow` DTO happens in
 * `helpers.ts#toEvalBatchRowDto`.
 *
 * `getBatch(batchId)` (a single-batch-by-id lookup) was removed: its `GROUP
 * BY` was a genuine SQL bug (grouped by `batch_id` alone while also selecting
 * the ungrouped `eval_cases.owner_id`, so Postgres rejected every call), and
 * every real caller already resolves a batch via `listBatches(agentId)` + a
 * `Map` lookup instead (see `dashboard.service.ts#compareBatches`), which is
 * also correctly workspace-scoped once the caller has verified `agentId`
 * belongs to the requesting workspace (e.g. via `container.agentsRepo.
 * getById`) — the same caveat that applied to `getBatch` itself.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;

export interface InsertEvalCase {
  workspaceId: string;
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface UpdateEvalCase {
  name?: string;
  inputDiff?: string | null;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
}

export interface InsertEvalRun {
  caseId: string;
  actualOutput?: unknown;
  pass?: boolean | null;
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
  /** Groups this run into an agent-version batch execution (nullable — older,
   *  pre-batching runs and ad-hoc single-case runs may omit it). */
  batchId?: string | null;
  /** The agent's config version this run executed against (nullable, same
   *  reason as `batchId`). */
  agentVersion?: number | null;
}

/** One row per distinct batch, aggregated across all its case runs. Not a
 *  public DTO — `helpers.ts#toEvalBatchRowDto` maps this to `EvalBatchRow`. */
export interface EvalBatchAggregateRow {
  batchId: string;
  agentId: string;
  agentVersion: number | null;
  ranAt: Date;
  recall: number;
  precision: number;
  citationAccuracy: number;
  tracesPassed: number;
  tracesTotal: number;
  costUsd: number | null;
}

export class EvalsRepository {
  constructor(private db: Db) {}

  // ---- eval_cases (workspace-scoped directly) -----------------------------

  async createCase(values: InsertEvalCase): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId: values.workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        inputDiff: values.inputDiff ?? null,
        inputFiles: (values.inputFiles as object | undefined) ?? null,
        inputMeta: (values.inputMeta as object | undefined) ?? null,
        expectedOutput: (values.expectedOutput as object | undefined) ?? null,
        notes: values.notes ?? null,
      })
      .returning();
    return row!;
  }

  async getCase(workspaceId: string, id: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)));
    return row;
  }

  async listCasesForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  async updateCase(
    workspaceId: string,
    id: string,
    patch: UpdateEvalCase,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined ? { inputFiles: patch.inputFiles as object } : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning();
    return row;
  }

  /** Returns false if no such case existed in the workspace. `eval_runs` rows
   *  for this case cascade-delete via the FK (`onDelete: 'cascade'`). */
  async deleteCase(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, id)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // ---- eval_runs (workspace-scoped transitively via eval_cases) -----------

  /** Insert a run for a case. See the class-level doc — the caller must have
   *  already verified `caseId` belongs to the requesting workspace. */
  async insertRun(values: InsertEvalRun): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        caseId: values.caseId,
        actualOutput: (values.actualOutput as object | undefined) ?? null,
        pass: values.pass ?? null,
        recall: values.recall ?? null,
        precision: values.precision ?? null,
        citationAccuracy: values.citationAccuracy ?? null,
        durationMs: values.durationMs ?? null,
        costUsd: values.costUsd ?? null,
        batchId: values.batchId ?? null,
        agentVersion: values.agentVersion ?? null,
      })
      .returning();
    return row!;
  }

  /** All runs for one case, newest first, scoped to the requesting workspace
   *  via a join to `eval_cases`. */
  async listRunsForCase(workspaceId: string, caseId: string): Promise<EvalRunRow[]> {
    const rows = await this.db
      .select({ run: t.evalRuns })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalRuns.caseId, caseId)))
      .orderBy(desc(t.evalRuns.ranAt));
    return rows.map((r) => r.run);
  }

  /** All runs across every case owned by one agent, newest first, scoped to
   *  the requesting workspace via a join to `eval_cases`. */
  async listRunsForAgent(workspaceId: string, agentId: string): Promise<EvalRunRow[]> {
    const rows = await this.db
      .select({ run: t.evalRuns })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
        ),
      )
      .orderBy(desc(t.evalRuns.ranAt));
    return rows.map((r) => r.run);
  }

  // ---- batches (grouped eval_runs, no dedicated table) ---------------------

  /** Every batch for one agent, newest first, MICRO-averaged via
   *  `helpers.ts#groupRunsIntoBatches`. NOT workspace-scoped by itself —
   *  callers resolve `agentId` under a workspace first (e.g. via
   *  `container.agentsRepo.getById`). */
  async listBatches(agentId: string): Promise<EvalBatchAggregateRow[]> {
    const rows = await this.listRunRowsForAgent(agentId);
    return groupRunsIntoBatches(rows);
  }

  /** The most recent batch for every agent that has run at least one batch in
   *  this workspace — the base data for the cross-agent Eval Dashboard. */
  async latestBatchPerAgent(workspaceId: string): Promise<EvalBatchAggregateRow[]> {
    const rows = await this.listRunRowsForWorkspace(workspaceId);
    const batches = groupRunsIntoBatches(rows); // newest first already

    // One row per agent: `batches` is ordered newest-batch-first, so the
    // first row encountered per `agentId` is that agent's latest batch.
    const latest = new Map<string, EvalBatchAggregateRow>();
    for (const batch of batches) {
      if (!latest.has(batch.agentId)) latest.set(batch.agentId, batch);
    }
    return [...latest.values()];
  }

  /** Raw per-case `eval_runs` rows (joined to their owning `eval_cases`),
   *  scoped to one agent's batched runs — the input `groupRunsIntoBatches`
   *  MICRO-averages. Each row's `ran_at` is a direct column select (not a SQL
   *  aggregate expression), so postgres.js parses it as a real `Date`. */
  private async listRunRowsForAgent(
    agentId: string,
  ): Promise<Array<EvalRunRow & { agentId: string }>> {
    const rows = await this.db
      .select({ run: t.evalRuns, agentId: t.evalCases.ownerId })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.ownerKind, 'agent'),
          eq(t.evalCases.ownerId, agentId),
          isNotNull(t.evalRuns.batchId),
        ),
      );
    return rows.map((r) => ({ ...r.run, agentId: r.agentId }));
  }

  /** Same shape as `listRunRowsForAgent`, scoped to every agent-owned batched
   *  run in a workspace — feeds `latestBatchPerAgent`'s cross-agent rollup. */
  private async listRunRowsForWorkspace(
    workspaceId: string,
  ): Promise<Array<EvalRunRow & { agentId: string }>> {
    const rows = await this.db
      .select({ run: t.evalRuns, agentId: t.evalCases.ownerId })
      .from(t.evalRuns)
      .innerJoin(t.evalCases, eq(t.evalRuns.caseId, t.evalCases.id))
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          isNotNull(t.evalRuns.batchId),
        ),
      );
    return rows.map((r) => ({ ...r.run, agentId: r.agentId }));
  }
}

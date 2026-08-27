import type {
  EvalAgentSummary,
  EvalBatchRow,
  EvalCompareResult,
  EvalDashboard,
  EvalDashboardCross,
  EvalRunRecord,
  EvalTrendPoint,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import type { EvalBatchAggregateRow, EvalsRepository } from './repository.js';
import { toEvalBatchRowDto, toEvalRunRecordDto } from './helpers.js';
import { runBatch, NoEvalCasesError } from './run-executor.js';
import { DEFAULT_BATCH_LIST_LIMIT, DEFAULT_RUN_LIST_LIMIT } from './constants.js';

/**
 * T7 — dashboard/history/compare/cross-agent + run-all. Application-layer
 * service (onion "Application" ring): depends on `container`/ports and this
 * module's own `repository`/`helpers`/`run-executor`, never on `src/adapters/**`
 * directly and never on `db/schema` (that stays inside `repository.ts`).
 *
 * `EvalsRepository.getBatch(batchId)` (a single-batch-by-id lookup) was
 * removed — it had both a workspace-scoping gap and a genuine SQL `GROUP BY`
 * bug (see `repository.ts` class doc + `server/INSIGHTS.md`). Every method
 * here resolves a batch via `listBatches(agentId)`/`latestBatchPerAgent`
 * instead, under an agent that was ALREADY verified under the caller's
 * workspace via `container.agentsRepo.getById(workspaceId, agentId)` (AC-40).
 * `listBatches`/`latestBatchPerAgent` now MICRO-average each batch (AC-21/22/
 * 23) via `helpers.ts#groupRunsIntoBatches` reusing reviewer-core's
 * `aggregateBatch` — the same formula backing the synchronous
 * `POST /agents/:id/eval-runs` response — instead of the prior SQL
 * `avg()` MACRO-average.
 */

/** How many agents' batches run concurrently for `POST /eval/run-all` (AC-43) —
 *  bounds the worst-case number of in-flight LLM calls a single click can
 *  trigger. Combined with the route's `config.rateLimit`. */
const RUN_ALL_CONCURRENCY = 3;

/** How many recent batches to fetch per agent when building trends/history —
 *  keeps cross-agent aggregation queries bounded. */
const TREND_BATCH_LIMIT = DEFAULT_BATCH_LIST_LIMIT;

export class EvalDashboardService {
  constructor(private container: Container) {}

  private get evalsRepo(): EvalsRepository {
    return this.container.evalsRepo;
  }

  // =========================================================================
  // (a) GET /agents/:id/eval-dashboard — AC-30, AC-31, Q6 alert
  // =========================================================================

  async getAgentDashboard(
    workspaceId: string,
    agentId: string,
  ): Promise<EvalDashboard & { batches: EvalBatchRow[] }> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    const [batchAggs, cases, runRows] = await Promise.all([
      this.evalsRepo.listBatches(agentId), // newest first
      this.evalsRepo.listCasesForOwner(workspaceId, 'agent', agentId),
      this.evalsRepo.listRunsForAgent(workspaceId, agentId), // newest first
    ]);

    // `batchAggs` rows already carry a real `Date` `ranAt` (grouped/aggregated
    // in JS from direct-column-select rows — see `helpers.ts#groupRunsIntoBatches`),
    // no runtime coercion needed here.
    const batches = batchAggs.map(toEvalBatchRowDto);
    const latest = batchAggs[0];
    const previous = batchAggs[1];

    const current = latest
      ? {
          recall: latest.recall,
          precision: latest.precision,
          citation_accuracy: latest.citationAccuracy,
          traces_passed: latest.tracesPassed,
          traces_total: latest.tracesTotal,
          cost_usd: latest.costUsd,
        }
      : {
          recall: 0,
          precision: 0,
          citation_accuracy: 0,
          traces_passed: 0,
          traces_total: 0,
          cost_usd: null,
        };

    const delta = previous
      ? {
          recall: current.recall - previous.recall,
          precision: current.precision - previous.precision,
          citation_accuracy: current.citation_accuracy - previous.citationAccuracy,
        }
      : { recall: 0, precision: 0, citation_accuracy: 0 };

    // Trend per version — one point per batch, chronological (oldest first).
    const trend = buildTrend(batchAggs);

    const caseNameById = new Map(cases.map((c) => [c.id, c.name]));
    const recentRuns: EvalRunRecord[] = runRows
      .slice(0, DEFAULT_RUN_LIST_LIMIT)
      .map((row) => toEvalRunRecordDto(row, caseNameById.get(row.caseId) ?? null));

    const alert = computeAlert(delta, latest?.agentVersion ?? null);

    return {
      owner_kind: 'agent',
      owner_id: agentId,
      cases_total: cases.length,
      current,
      delta,
      trend,
      recent_runs: recentRuns,
      alert,
      batches,
    };
  }

  // =========================================================================
  // (b) GET /agents/:id/eval-compare?a=&b= — AC-32..35
  // =========================================================================

  async compareBatches(
    workspaceId: string,
    agentId: string,
    batchIdA: string,
    batchIdB: string,
  ): Promise<EvalCompareResult> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');

    // Resolve both batches via `listBatches(agentId)` — this also naturally
    // satisfies AC-40: any batch id not owned by this (already workspace-
    // verified) agent simply won't be in the list.
    const agentBatches = await this.evalsRepo.listBatches(agentId);
    const byId = new Map(agentBatches.map((row) => [row.batchId, row]));
    const rowA = byId.get(batchIdA);
    const rowB = byId.get(batchIdB);
    if (!rowA) throw new NotFoundError('Batch not found');
    if (!rowB) throw new NotFoundError('Batch not found');

    const [olderAgg, newerAgg] =
      rowA.ranAt.getTime() <= rowB.ranAt.getTime() ? [rowA, rowB] : [rowB, rowA];

    const older = toEvalBatchRowDto(olderAgg);
    const newer = toEvalBatchRowDto(newerAgg);

    const deltas = {
      recall: newer.recall - older.recall,
      precision: newer.precision - older.precision,
      citation_accuracy: newer.citation_accuracy - older.citation_accuracy,
    };

    const promptDiff = await this.diffSystemPrompts(agentId, olderAgg.agentVersion, newerAgg.agentVersion);

    const traceCountNotice =
      older.traces_total !== newer.traces_total
        ? `Trace counts differ: ${older.traces_total} vs ${newer.traces_total}`
        : null;

    return {
      older,
      newer,
      deltas,
      prompt_diff: promptDiff,
      trace_count_notice: traceCountNotice,
    };
  }

  /** AC-33/34 — diff the two batches' system-prompt SNAPSHOTS (never the live
   *  agent config). `null` when either side's version has no recorded snapshot
   *  (client renders "prompt diff unavailable"). */
  private async diffSystemPrompts(
    agentId: string,
    olderVersion: number | null,
    newerVersion: number | null,
  ): Promise<{ added: string[]; removed: string[] } | null> {
    if (olderVersion === null || newerVersion === null) return null;

    const [olderSnapshot, newerSnapshot] = await Promise.all([
      this.container.agentsRepo.getVersion(agentId, olderVersion),
      this.container.agentsRepo.getVersion(agentId, newerVersion),
    ]);
    if (!olderSnapshot || !newerSnapshot) return null;

    const olderPrompt = (olderSnapshot.configJson as { system_prompt?: string }).system_prompt ?? '';
    const newerPrompt = (newerSnapshot.configJson as { system_prompt?: string }).system_prompt ?? '';
    return diffLines(olderPrompt, newerPrompt);
  }

  // =========================================================================
  // (c) GET /eval/dashboard — AC-36, AC-37, AC-38
  // =========================================================================

  async getCrossAgentDashboard(workspaceId: string): Promise<EvalDashboardCross> {
    const [agents, latestAggs] = await Promise.all([
      this.container.agentsRepo.list(workspaceId),
      this.evalsRepo.latestBatchPerAgent(workspaceId),
    ]);

    const latestByAgentId = new Map(latestAggs.map((row) => [row.agentId, row]));

    // Only agents that have run at least once need a batch-history fetch for
    // their trend — never-run agents get an empty trend + `latest: null`
    // (AC-38 empty state) without an extra query.
    const agentsWithRuns = agents.filter((a) => latestByAgentId.has(a.id));
    const batchListsByAgentId = new Map(
      await Promise.all(
        agentsWithRuns.map(async (a) => [a.id, await this.evalsRepo.listBatches(a.id)] as const),
      ),
    );

    const summaries: EvalAgentSummary[] = agents.map((agent) => {
      const latestAgg = latestByAgentId.get(agent.id);
      const batchAggs = batchListsByAgentId.get(agent.id) ?? [];
      return {
        agent_id: agent.id,
        name: agent.name,
        model: agent.model,
        latest: latestAgg ? toEvalBatchRowDto(latestAgg) : null,
        trend: buildTrend(batchAggs.slice(0, TREND_BATCH_LIMIT)),
      };
    });

    // Most-recent-first feed across every agent (AC-37) — flatten each
    // agent's already-fetched batch history and re-sort by ran_at.
    const recentBatches = [...batchListsByAgentId.values()]
      .flat()
      .sort((a, b) => b.ranAt.getTime() - a.ranAt.getTime())
      .slice(0, DEFAULT_BATCH_LIST_LIMIT)
      .map(toEvalBatchRowDto);

    return { agents: summaries, recent_batches: recentBatches };
  }

  // =========================================================================
  // (d) POST /eval/run-all — AC-39, AC-43 (bounded concurrency)
  // =========================================================================

  async runAll(workspaceId: string): Promise<EvalBatchRow[]> {
    const agents = await this.container.agentsRepo.list(workspaceId);

    const results = await mapWithConcurrency(agents, RUN_ALL_CONCURRENCY, async (agent) => {
      try {
        await runBatch(this.container, this.evalsRepo, workspaceId, agent);
      } catch (err) {
        // AC-39 — skip agents with zero eval cases rather than failing the
        // whole run-all; tolerate any other per-agent engine failure the same
        // way (one flaky agent must not abort the batch for everyone else —
        // per-case failures are already isolated inside `runBatch` itself).
        if (err instanceof NoEvalCasesError) return null;
        return null;
      }
      // `runBatch` doesn't return the minted batch_id — the newest batch for
      // this agent (ordered newest-first) is the one just written.
      const [newest] = await this.evalsRepo.listBatches(agent.id);
      return newest ? toEvalBatchRowDto(newest) : null;
    });

    return results.filter((row): row is EvalBatchRow => row !== null);
  }
}

// =============================================================================
// Pure helpers (no I/O)
// =============================================================================

function buildTrend(batchAggsNewestFirst: EvalBatchAggregateRow[]): EvalTrendPoint[] {
  // Chronological (oldest → newest) for charting.
  return [...batchAggsNewestFirst]
    .reverse()
    .map((row) => ({
      ran_at: row.ranAt.toISOString(),
      recall: row.recall,
      precision: row.precision,
      citation_accuracy: row.citationAccuracy,
      pass_rate: row.tracesTotal === 0 ? 0 : row.tracesPassed / row.tracesTotal,
      cost_usd: row.costUsd,
    }));
}

/** Q6 — deterministic alert copy from metric deltas, no model call. Reports
 *  the first notable dip found (precision, then recall, then citation
 *  accuracy); `null` when nothing dipped (or there's no previous batch to
 *  compare against, i.e. `delta` is all zeros). */
function computeAlert(
  delta: { recall: number; precision: number; citation_accuracy: number },
  latestVersion: number | null,
): string | null {
  const versionSuffix = latestVersion !== null ? ` on v${latestVersion}` : '';
  if (delta.precision < 0) {
    return `Precision dipped ${formatPoints(delta.precision)}pt${versionSuffix}`;
  }
  if (delta.recall < 0) {
    return `Recall dipped ${formatPoints(delta.recall)}pt${versionSuffix}`;
  }
  if (delta.citation_accuracy < 0) {
    return `Citation accuracy dipped ${formatPoints(delta.citation_accuracy)}pt${versionSuffix}`;
  }
  return null;
}

function formatPoints(delta: number): number {
  return Math.round(Math.abs(delta) * 100);
}

/** Simple line-based set-difference diff (order-agnostic): lines present in
 *  `newer` but not `older` are "added"; lines present in `older` but not
 *  `newer` are "removed". Sufficient for surfacing a system-prompt diff in
 *  the compare view — not a full LCS/Myers diff. */
function diffLines(older: string, newer: string): { added: string[]; removed: string[] } {
  const olderLines = older.split('\n');
  const newerLines = newer.split('\n');
  const olderSet = new Set(olderLines);
  const newerSet = new Set(newerLines);

  const added = newerLines.filter((line) => !olderSet.has(line));
  const removed = olderLines.filter((line) => !newerSet.has(line));

  return { added, removed };
}

/** Run `fn` over `items` with at most `limit` in flight at once — bounds the
 *  worst-case concurrent LLM calls `run-all` can trigger (AC-43). Order of
 *  `results` matches `items`. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current]!);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

import { randomUUID } from 'node:crypto';
import type {
  AgentVersionConfig,
  EvalPerTrace,
  EvalRun,
  EvalRunRecord,
  ExpectedFinding,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import {
  reviewPullRequest,
  scoreCase,
  aggregateBatch,
  type CaseScore,
  type BatchCaseInput,
} from '@devdigest/reviewer-core';
import type { Container } from '../../platform/container.js';
import type { AgentRow } from '../../db/rows.js';
import { parseEvalDiff } from './diff.js';
import { ValidationError, NotFoundError } from '../../platform/errors.js';
import type { EvalsRepository, EvalCaseRow, EvalRunRow } from './repository.js';
import { toEvalRunRecordDto, toEvalRunCounts } from './helpers.js';

/**
 * T6 — run-executor: the reusable core that executes an agent's eval cases
 * through the REAL `reviewer-core` engine (only the injected `LLMProvider` may
 * be a test double — the engine itself, grounding, and scoring always run for
 * real). Exported functions are consumed by:
 *   - this module's own `run.routes.ts` (`POST /agents/:id/eval-runs` batch run)
 *   - T7's `POST /eval/run-all`, which calls `runBatch` per eligible agent
 *   - T8's single-case "Run on save" route, which calls `runCaseOnce` directly
 *     (with no `batchId`)
 * so none of the three duplicate engine-invocation / scoring / persistence
 * logic (see docs/plans/2026-08-26-agent-eval-pipeline.md, task T6).
 */

// ===========================================================================
// Config resolution (AC-15, AC-16)
// ===========================================================================

/** Config actually fed to the engine for one run — resolved from either the
 *  `agent_versions` snapshot for the agent's current version, or (AC-16) the
 *  live agent row when no snapshot exists for that version. Skill ids are
 *  already resolved to enabled skill BODIES. */
export interface ResolvedRunConfig {
  provider: Provider;
  model: string;
  systemPrompt: string;
  strategy: ReviewStrategy;
  /** Resolved skill BODIES (not ids), filtered to enabled skills, in the
   *  order recorded at snapshot/link time. */
  skillBodies: string[];
}

/**
 * Resolve the config an eval batch/case run should execute against (AC-15,
 * AC-16): prefer the `agent_versions` snapshot for `agent.version`; fall back
 * to the live `agents` row when no snapshot was ever recorded for that
 * version (the caller still records `agent.version` as the version that ran —
 * see `runBatch`/`runCaseOnce` callers). Snapshot/live skill ids are resolved
 * to enabled skill BODIES via `agentsRepo.linkedSkills` (the CURRENT link
 * rows, filtered down to the ids the snapshot/live config names) — mirrors
 * the pattern in `modules/reviews/run-executor.ts`.
 */
export async function resolveRunConfig(
  container: Container,
  agent: AgentRow,
): Promise<ResolvedRunConfig> {
  const snapshot = await container.agentsRepo.getVersion(agent.id, agent.version);
  const cfg: Pick<AgentVersionConfig, 'provider' | 'model' | 'system_prompt' | 'strategy' | 'skills'> =
    snapshot
      ? (snapshot.configJson as AgentVersionConfig)
      : {
          provider: agent.provider,
          model: agent.model,
          system_prompt: agent.systemPrompt,
          strategy: agent.strategy,
          skills: await container.agentsRepo.skillIdsForAgent(agent.id),
        };

  const skillBodies = await resolveSkillBodies(container, agent.id, cfg.skills);

  return {
    provider: cfg.provider,
    model: cfg.model,
    systemPrompt: cfg.system_prompt,
    strategy: cfg.strategy,
    skillBodies,
  };
}

async function resolveSkillBodies(
  container: Container,
  agentId: string,
  skillIds: string[],
): Promise<string[]> {
  if (skillIds.length === 0) return [];
  const linked = await container.agentsRepo.linkedSkills(agentId);
  const byId = new Map(linked.map((l) => [l.skill.id, l.skill]));
  const bodies: string[] = [];
  for (const id of skillIds) {
    const skill = byId.get(id);
    if (skill?.enabled) bodies.push(skill.body);
  }
  return bodies;
}

// ===========================================================================
// Single-case execution (T8 reuses this directly)
// ===========================================================================

/** Outcome of executing ONE eval case against the engine + persisting its
 *  `eval_runs` row. `failed` distinguishes an engine error (AC-19) from a
 *  normally-scored run — `score`/`costUsd` are only meaningful when `!failed`. */
export interface CaseRunOutcome {
  runRow: EvalRunRow;
  record: EvalRunRecord;
  perTrace: EvalPerTrace;
  score: CaseScore | null;
  costUsd: number | null;
  failed: boolean;
  reason?: string;
}

/**
 * Execute ONE eval case through `reviewPullRequest` and persist its
 * `eval_runs` row. Engine failures (provider error, unparseable structured
 * output after retries, an unparseable `input_diff`) are caught HERE and
 * persisted as a FAILED row carrying the reason (AC-19) instead of throwing —
 * the caller (the batch loop, or a single-case route) decides what to do
 * next; a batch never aborts because of one bad case.
 */
export async function runCaseOnce(
  container: Container,
  evalsRepo: EvalsRepository,
  runConfig: ResolvedRunConfig,
  caseRow: EvalCaseRow,
  opts: { batchId?: string | null; agentVersion?: number | null } = {},
): Promise<CaseRunOutcome> {
  const start = Date.now();
  const expected = (caseRow.expectedOutput as ExpectedFinding[] | null) ?? [];

  try {
    // AC-13 — the case's FROZEN input_diff, parsed; never a live PR/git diff load.
    const diff = parseEvalDiff(caseRow.inputDiff ?? '');
    const llm = await container.llm(runConfig.provider);

    // AC-14 — no callers/repoMap/intent/specs/prDescription: disabled by
    // OMISSION (never passed), regardless of the agent's `repo_intel` flag.
    // AC-17 — grounding stays enabled inside the engine (never disabled here).
    // AC-41/AC-42 — `wrapUntrusted` + the injection guard happen INSIDE
    // `reviewPullRequest`/`assemblePrompt` — RAW frozen strings are passed.
    const outcome = await reviewPullRequest({
      systemPrompt: runConfig.systemPrompt,
      model: runConfig.model,
      diff,
      llm,
      strategy: runConfig.strategy,
      ...(runConfig.skillBodies.length > 0 ? { skills: runConfig.skillBodies } : {}),
    });

    // duration_ms is measured HERE — the engine does not time itself (AC-29).
    const durationMs = Date.now() - start;
    const produced = outcome.review.findings;
    const candidateCount = produced.length + outcome.dropped.length;
    const score = scoreCase(expected, produced, candidateCount);

    const runRow = await evalsRepo.insertRun({
      caseId: caseRow.id,
      // AC-21/22/23 fix — carry the raw counts alongside the findings so a
      // batch read-back can MICRO-average (`helpers.ts#groupRunsIntoBatches`)
      // instead of macro-averaging the persisted ratio columns.
      actualOutput: { findings: produced, counts: toEvalRunCounts(score) },
      pass: score.pass,
      recall: score.recall,
      precision: score.precision,
      citationAccuracy: score.citation_accuracy,
      durationMs,
      costUsd: outcome.costUsd,
      batchId: opts.batchId ?? null,
      agentVersion: opts.agentVersion ?? null,
    });

    return {
      runRow,
      record: toEvalRunRecordDto(runRow, caseRow.name),
      perTrace: { name: caseRow.name, pass: score.pass, expected, actual: produced },
      score,
      costUsd: outcome.costUsd,
      failed: false,
    };
  } catch (err) {
    const durationMs = Date.now() - start;
    const reason = err instanceof Error ? err.message : String(err);

    const runRow = await evalsRepo.insertRun({
      caseId: caseRow.id,
      // Same `counts` convention as the success path (see above) — an
      // outright engine failure still needs to contribute its case's
      // `expectedCount` (matched=0) to a batch's read-back MICRO-average, the
      // same way `failedCaseScore` already makes it contribute to the
      // in-memory `aggregateBatch` call in `runBatch` below.
      actualOutput: { error: reason, counts: toEvalRunCounts(failedCaseScore(expected)) },
      pass: false,
      recall: null,
      precision: null,
      citationAccuracy: null,
      durationMs,
      costUsd: null,
      batchId: opts.batchId ?? null,
      agentVersion: opts.agentVersion ?? null,
    });

    return {
      runRow,
      record: toEvalRunRecordDto(runRow, caseRow.name),
      perTrace: { name: caseRow.name, pass: false, expected, actual: { error: reason } },
      score: null,
      costUsd: null,
      failed: true,
      reason,
    };
  }
}

/** A failed case's contribution to the batch aggregate: an outright miss
 *  (never counted as a pass, never a vacuous "1.0" the way an empty-expected
 *  case would score). Kept local to this module since `reviewer-core`'s
 *  `scoreCase` has no "the engine never produced output" notion of its own. */
function failedCaseScore(expected: ExpectedFinding[]): CaseScore {
  return {
    recall: 0,
    precision: 0,
    citation_accuracy: 0,
    pass: false,
    expectedCount: expected.length,
    matchedExpectedCount: 0,
    producedCount: 0,
    matchedProducedCount: 0,
    survivedCount: 0,
    candidateCount: 0,
  };
}

// ===========================================================================
// Batch execution (T7's run-all reuses this per eligible agent)
// ===========================================================================

/** Thrown when a batch run is requested for an agent with zero eval cases
 *  (AC-18) — a `ValidationError` (422) so the route needs no bespoke mapping;
 *  callers that want to silently skip caseless agents (T7's run-all) can
 *  `instanceof` it. */
export class NoEvalCasesError extends ValidationError {
  constructor(agentId: string) {
    super('No eval cases to run for this agent', { agentId });
  }
}

export interface RunBatchResult {
  batch: EvalRun;
  runs: EvalRunRecord[];
}

/**
 * Execute a batch run: every `eval_cases` row owned by `agent`, through
 * `runCaseOnce`, sharing one minted `batch_id` + the agent's CURRENT version
 * (AC-12, AC-15). Rejects with `NoEvalCasesError` (AC-18) rather than writing
 * an empty batch when the agent has zero cases. Per-case engine failures are
 * isolated by `runCaseOnce` — the batch always completes (AC-19).
 */
export async function runBatch(
  container: Container,
  evalsRepo: EvalsRepository,
  workspaceId: string,
  agent: AgentRow,
): Promise<RunBatchResult> {
  const cases = await evalsRepo.listCasesForOwner(workspaceId, 'agent', agent.id);
  if (cases.length === 0) throw new NoEvalCasesError(agent.id);

  const batchId = randomUUID();
  const runConfig = await resolveRunConfig(container, agent);

  const batchStart = Date.now();
  const records: EvalRunRecord[] = [];
  const perCase: BatchCaseInput[] = [];
  const perTrace: EvalPerTrace[] = [];

  for (const caseRow of cases) {
    const result = await runCaseOnce(container, evalsRepo, runConfig, caseRow, {
      batchId,
      agentVersion: agent.version,
    });
    records.push(result.record);
    perTrace.push(result.perTrace);
    perCase.push({
      score: result.failed
        ? failedCaseScore((caseRow.expectedOutput as ExpectedFinding[] | null) ?? [])
        : result.score!,
      costUsd: result.costUsd,
    });
  }

  const aggregate = aggregateBatch(perCase);
  const batch: EvalRun = {
    recall: aggregate.recall,
    precision: aggregate.precision,
    citation_accuracy: aggregate.citation_accuracy,
    traces_passed: aggregate.traces_passed,
    traces_total: aggregate.traces_total,
    duration_ms: Date.now() - batchStart,
    cost_usd: aggregate.cost_usd,
    per_trace: perTrace,
  };

  return { batch, runs: records };
}

/**
 * Resolve `agentId` under `workspaceId` (404 if missing/foreign) then run its
 * batch — the entry point `POST /agents/:id/eval-runs` calls so the route
 * itself stays thin (`getContext` → one service call → reply), matching the
 * capture/dashboard/cases routes' pattern instead of doing the agent lookup +
 * `NotFoundError` inline. `runAll` (below, via `dashboard.service.ts`)
 * already holds a workspace-verified `AgentRow` for every agent it iterates
 * (from `agentsRepo.list(workspaceId)`) and calls `runBatch` directly instead
 * — going through this wrapper there would cost one redundant lookup per
 * agent in an already-bounded-concurrency loop.
 */
export async function runBatchForAgent(
  container: Container,
  evalsRepo: EvalsRepository,
  workspaceId: string,
  agentId: string,
): Promise<RunBatchResult> {
  const agent = await container.agentsRepo.getById(workspaceId, agentId);
  if (!agent) throw new NotFoundError('Agent not found');
  return runBatch(container, evalsRepo, workspaceId, agent);
}

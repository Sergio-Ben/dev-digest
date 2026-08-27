import { z } from 'zod';
import type { EvalCase, EvalRun, EvalRunRecord, EvalRunResult } from '@devdigest/shared';
import { ExpectedFinding } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import type { AgentRow } from '../../db/rows.js';
import type { EvalCaseRow, InsertEvalCase, UpdateEvalCase } from './repository.js';
import { toEvalCaseDto, toEvalRunRecordDto } from './helpers.js';
import { resolveRunConfig, runCaseOnce } from './run-executor.js';

/**
 * T8 — eval case CRUD + single-case run (Capability B, "Run on save"). Owns
 * `eval_cases` mutation/read (through `EvalsRepository`, never touches
 * `db/schema` directly — onion rule) and the single-case run path, which
 * REUSES T6's `resolveRunConfig`/`runCaseOnce` rather than re-invoking the
 * engine itself.
 *
 * AC-40 (workspace scoping): every method below either resolves the case
 * through `EvalsRepository.getCase(workspaceId, id)` (which is already
 * workspace-scoped on `eval_cases.workspace_id`, so a cross-workspace id is
 * indistinguishable from a missing one) or, for the agent-nested routes,
 * verifies the owning agent belongs to the workspace via
 * `container.agentsRepo.getById` before trusting the route's `:id` as the
 * case's owner.
 */

const ExpectedFindings = z.array(ExpectedFinding);

/** Case DTO plus its latest run (or `null` if never run) — fills the gap
 *  noted for `GET /agents/:id/eval-cases` so the client can render
 *  pass/fail/never-run without a second round trip. A never-run case, or one
 *  whose latest run was never scored, keeps `latest_run: null` — this route
 *  never invents a status (AC-8). */
export interface EvalCaseWithLatestRun extends EvalCase {
  latest_run: EvalRunRecord | null;
}

export class CasesService {
  constructor(private container: Container) {}

  // ---- list / create (nested under an agent) ------------------------------

  /** List every case owned by `agentId`, each annotated with its latest run
   *  (AC-7, AC-8). Verifies `agentId` belongs to `workspaceId` first (AC-40). */
  async listForAgent(workspaceId: string, agentId: string): Promise<EvalCaseWithLatestRun[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.container.evalsRepo.listCasesForOwner(workspaceId, 'agent', agentId);
    return Promise.all(rows.map((row) => this.withLatestRun(workspaceId, row)));
  }

  /** Manually create a case under `agentId` (case editor "New case"). The
   *  owner (`owner_kind`/`owner_id`) is ALWAYS resolved from the route, never
   *  trusted from the request body, even though the body carries those same
   *  fields (the shared `EvalCaseInput` schema is reused for both the
   *  create-under-agent and generic shapes) — a caller cannot mint a case
   *  under an agent it doesn't own by spoofing `owner_id`. `expected_output`
   *  is validated against `z.array(ExpectedFinding)` and rejected with field
   *  errors on a malformed save (AC-10). */
  async createForAgent(
    workspaceId: string,
    agentId: string,
    input: CreateCaseInput,
  ): Promise<EvalCase> {
    await this.requireAgent(workspaceId, agentId);
    const expectedOutput = this.validateExpectedOutput(input.expected_output);

    const values: InsertEvalCase = {
      workspaceId,
      ownerKind: 'agent',
      ownerId: agentId,
      name: input.name,
      inputDiff: input.input_diff ?? null,
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput,
      notes: input.notes ?? null,
    };
    const row = await this.container.evalsRepo.createCase(values);
    return toEvalCaseDto(row);
  }

  // ---- single case (id-addressed) ------------------------------------------

  /** Fetch one case by id, workspace-scoped (AC-40). */
  async get(workspaceId: string, id: string): Promise<EvalCase> {
    const row = await this.requireCase(workspaceId, id);
    return toEvalCaseDto(row);
  }

  /** Update a case's editable fields. `owner_kind`/`owner_id` are never
   *  accepted on update — an existing case's owner never changes. Re-validates
   *  `expected_output` the same way `createForAgent` does (AC-10). */
  async update(workspaceId: string, id: string, patch: UpdateCaseInput): Promise<EvalCase> {
    await this.requireCase(workspaceId, id);

    const values: UpdateEvalCase = {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.input_diff !== undefined ? { inputDiff: patch.input_diff } : {}),
      ...(patch.input_files !== undefined ? { inputFiles: patch.input_files } : {}),
      ...(patch.input_meta !== undefined ? { inputMeta: patch.input_meta } : {}),
      ...(patch.expected_output !== undefined
        ? { expectedOutput: this.validateExpectedOutput(patch.expected_output) }
        : {}),
      ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
    };

    const row = await this.container.evalsRepo.updateCase(workspaceId, id, values);
    if (!row) throw new NotFoundError('Eval case not found');
    return toEvalCaseDto(row);
  }

  /** Delete a case (its runs cascade via the FK). Returns `false` if no such
   *  case existed in the workspace (the route maps that to a 404). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.container.evalsRepo.deleteCase(workspaceId, id);
  }

  // ---- single-case run ("Run" / "Run on save", AC-11) ----------------------

  /**
   * Run ONE case through the real engine (reuses T6's `resolveRunConfig` +
   * `runCaseOnce` directly — this method never invokes `reviewPullRequest`
   * itself). No `batchId` is minted (a single-case run is not part of a
   * batch); `agentVersion` is still recorded so the run's provenance matches
   * a batch run's, same as every other persisted `eval_runs` row.
   */
  async run(workspaceId: string, id: string): Promise<EvalRunResult> {
    const caseRow = await this.requireCase(workspaceId, id);
    if (caseRow.ownerKind !== 'agent') {
      throw new ValidationError('Only agent-owned eval cases can be run.');
    }

    const agent = await this.requireAgent(workspaceId, caseRow.ownerId);
    const runConfig = await resolveRunConfig(this.container, agent);
    const outcome = await runCaseOnce(this.container, this.container.evalsRepo, runConfig, caseRow, {
      agentVersion: agent.version,
    });

    const result: EvalRun = {
      recall: outcome.score?.recall ?? 0,
      precision: outcome.score?.precision ?? 0,
      citation_accuracy: outcome.score?.citation_accuracy ?? 0,
      traces_passed: outcome.runRow.pass ? 1 : 0,
      traces_total: 1,
      duration_ms: outcome.runRow.durationMs ?? 0,
      cost_usd: outcome.costUsd,
      per_trace: [outcome.perTrace],
    };

    return { run_id: outcome.runRow.id, case_id: caseRow.id, result };
  }

  // ---- internal helpers -----------------------------------------------------

  private async requireCase(workspaceId: string, id: string): Promise<EvalCaseRow> {
    const row = await this.container.evalsRepo.getCase(workspaceId, id);
    if (!row) throw new NotFoundError('Eval case not found');
    return row;
  }

  private async requireAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  /** AC-10: `expected_output` must parse as `ExpectedFinding[]` — reject with
   *  field errors (`ZodError#flatten()`) rather than silently persisting an
   *  unusable shape the scorer can't read. */
  private validateExpectedOutput(expectedOutput: unknown): ExpectedFinding[] {
    const parsed = ExpectedFindings.safeParse(expectedOutput);
    if (!parsed.success) {
      throw new ValidationError('Invalid expected_output', parsed.error.flatten());
    }
    return parsed.data;
  }

  private async withLatestRun(
    workspaceId: string,
    row: EvalCaseRow,
  ): Promise<EvalCaseWithLatestRun> {
    const runs = await this.container.evalsRepo.listRunsForCase(workspaceId, row.id);
    const latest = runs[0]; // already newest-first (see `listRunsForCase`)
    return {
      ...toEvalCaseDto(row),
      latest_run: latest ? toEvalRunRecordDto(latest, row.name) : null,
    };
  }
}

// ---- service-level input shapes (route validates the wire shape) ----------

export interface CreateCaseInput {
  name: string;
  input_diff?: string | null;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string | null;
}

export interface UpdateCaseInput {
  name?: string;
  input_diff?: string | null;
  input_files?: unknown;
  input_meta?: unknown;
  expected_output?: unknown;
  notes?: string | null;
}

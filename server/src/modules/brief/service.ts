/**
 * service.ts — BriefService: orchestrates PR Brief composition for a PR.
 *
 * Onion layer: application layer — orchestrates repo + adapters + other
 * modules' public services; no SQL here (all persistence goes through
 * `ReviewRepository` / `BriefRepository`). Mirrors `intent/service.ts:27-40`'s
 * shape: a thin class constructed per-call with `(container, logger?)`.
 *
 * Ordering rationale (deviates from a naive "steps in listed order" reading):
 * the state key (`deriveStateKey`) is a function of ONLY headSha + changed
 * paths + intent + provider/model — it deliberately excludes blast radius and
 * resolved references. That means the cache-validity check can run BEFORE
 * touching blast/references/the diff at all. Doing so is required, not just
 * an optimisation: `BlastService.getForPr(..., { summary: true })` costs one
 * LLM call, so calling it unconditionally on every request (cache hit or not)
 * would silently break AC-23 ("a cache hit issues zero model calls") and the
 * documented non-functional promise ("a cache hit is a single row read").
 * So blast, the diff load, reference resolution, and the structured brief
 * call are all deferred until AFTER the cache check has confirmed a miss (or
 * `force` was requested) — see `composeAndPersist` below.
 *
 * Security: GitHub/webFetch are best-effort; a missing PAT/disabled flag
 * skips that enricher, never fails compose. Only a missing PR/repo throws.
 */
import type { Container } from '../../platform/container.js';
import type {
  Brief,
  BriefEnvelope,
  BriefResponse,
  BlastRadiusResult,
  Intent,
  Provider,
} from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewRepository } from '../reviews/repository.js';
import type { PullRow } from '../reviews/repository.js';
import { loadDiff } from '../reviews/diff-loader.js';
import { IntentService } from '../intent/service.js';
import { parseReferences, resolveReferences } from '../intent/references.js';
import { BlastService } from '../blast/service.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { composeBrief } from './composer.js';
import { groundBrief } from './grounding.js';
import { deriveStateKey, citableSets, fingerprintBlast } from './state-key.js';
import { BriefRepository } from './repository.js';
import { BRIEF_SCHEMA_VERSION } from './constants.js';
import { createSingleFlight } from '../../platform/single-flight.js';
import type { Logger } from '../reviews/run-executor.js';

/**
 * Per-process request coalescer for the compose-and-persist step, keyed by
 * `prId`. Module-level (not a class field) on purpose: `BriefService` is
 * constructed fresh per call site (mirroring `IntentService`), so an
 * instance-level map would not dedupe concurrent requests handled by two
 * different `BriefService` instances (AC-27).
 */
const composeSingleFlight = createSingleFlight<BriefResponse>();

/** Convert a persisted envelope into the HTTP response shape (G-d). */
function envelopeToResponse(env: BriefEnvelope): BriefResponse {
  return {
    brief: env.brief,
    degraded_inputs: env.degraded_inputs,
    head_sha: env.head_sha,
    generated_at: env.generated_at,
    provider: env.provider,
    model: env.model,
    tokens: env.tokens,
  };
}

/** AC-41: zero changed files — no citable set, nothing to ground, no model call. */
function emptyBriefResponse(headSha: string, provider: string, model: string): BriefResponse {
  const brief: Brief = {
    what: '',
    why: '',
    risk_level: 'low',
    risks: [],
    review_focus: [],
  };
  return {
    brief,
    degraded_inputs: ['no_changed_files'],
    head_sha: headSha,
    generated_at: new Date().toISOString(),
    provider,
    model,
    tokens: null,
  };
}

export class BriefService {
  private repo: ReviewRepository;
  private briefRepo: BriefRepository;
  private intentService: IntentService;
  private blastService: BlastService;
  private logger: Logger | undefined;

  constructor(private container: Container, logger?: Logger) {
    this.repo = new ReviewRepository(container.db);
    this.briefRepo = new BriefRepository(container.db);
    // Reach the other capabilities through their public service (onion rule
    // 6) — never another module's internal files.
    this.intentService = new IntentService(container, logger);
    this.blastService = new BlastService(container);
    this.logger = logger;
  }

  /** Lazy compose-on-read: returns the cached brief when valid, composes otherwise. */
  async getOrCompose(workspaceId: string, prId: string): Promise<BriefResponse> {
    return this.compose(workspaceId, prId, {});
  }

  /**
   * Compose (or return the cached) brief. `force: true` bypasses the cache
   * check and always recomposes (AC-25).
   */
  async compose(
    workspaceId: string,
    prId: string,
    opts: { force?: boolean },
  ): Promise<BriefResponse> {
    const force = opts.force ?? false;

    // 1. Load the PR row (workspace-scoped). Missing → NotFoundError (AC-31).
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError(`Pull request not found: ${prId}`);

    // 2. Load the repo row.
    const repoRow = await this.repo.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError(`Repository not found for PR: ${prId}`);

    // 3. Changed paths + diff stats, from pr_files. Zero changed files →
    //    short-circuit: no diff load, no intent/blast/reference work, no
    //    model call, nothing persisted (AC-41, Edge case).
    const prFiles = await this.repo.getPrFiles(prId);
    const changedPaths = prFiles.map((f) => f.path);

    // 8. Resolve the feature model for the risk_brief slot once — a settings
    //    read, not a model call, so it's safe to do unconditionally.
    const { provider, model } = await resolveFeatureModel(this.container, workspaceId, 'risk_brief');

    if (changedPaths.length === 0) {
      return emptyBriefResponse(pull.headSha, provider, model);
    }

    // 5. Resolve intent best-effort — failure adds `intent_unavailable` and
    //    the composer simply omits the section (AC-3, AC-6). `getOrCompute`
    //    is itself cache-aware, so a PR with a stored intent costs zero
    //    intent-model calls here.
    const degradedInputs: string[] = [];
    let intent: Intent | null = null;
    try {
      const record = await this.intentService.getOrCompute(workspaceId, prId);
      const { pr_id: _prId, ...rest } = record;
      intent = rest;
    } catch {
      degradedInputs.push('intent_unavailable');
    }

    // 9. Cache-validity key over headSha + changed paths + intent + provider/model
    //    (blast is deliberately excluded — see module doc comment).
    const stateKey = deriveStateKey({
      headSha: pull.headSha,
      changedPaths,
      intent,
      provider,
      model,
    });

    if (!force) {
      const stored = await this.briefRepo.getEnvelope(prId);
      if (stored && stored.state_key === stateKey) {
        // AC-23: cache hit — zero model calls, blast/references untouched.
        return envelopeToResponse(stored);
      }
    }

    // 10. Compose-and-persist, single-flighted per PR so concurrent requests
    //     for the same PR converge on one composition (AC-27).
    return composeSingleFlight(prId, () =>
      this.composeAndPersist({
        workspaceId,
        prId,
        pull,
        repoRow,
        changedPaths,
        prFiles,
        intent,
        degradedInputs,
        provider,
        model,
        stateKey,
      }),
    );
  }

  // ---- private: the actual (expensive) compose path ------------------------

  private async composeAndPersist(input: {
    workspaceId: string;
    prId: string;
    pull: PullRow;
    repoRow: NonNullable<Awaited<ReturnType<ReviewRepository['getRepo']>>>;
    changedPaths: string[];
    prFiles: Awaited<ReturnType<ReviewRepository['getPrFiles']>>;
    intent: Intent | null;
    degradedInputs: string[];
    provider: Provider;
    model: string;
    stateKey: string;
  }): Promise<BriefResponse> {
    const {
      workspaceId,
      prId,
      pull,
      repoRow,
      changedPaths,
      prFiles,
      intent,
      provider,
      model,
      stateKey,
    } = input;
    const degradedInputs = [...input.degradedInputs];

    // 4. Diff (hunk headers only reach the prompt — see prompt.ts).
    const diff = await loadDiff(this.container, this.repo, workspaceId, pull, repoRow);

    const diffStats = {
      additions: prFiles.reduce((sum, f) => sum + f.additions, 0),
      deletions: prFiles.reduce((sum, f) => sum + f.deletions, 0),
      changedFileCount: changedPaths.length,
    };

    // 6. Blast radius, best-effort — a `degraded: true` result or a throw
    //    records the reason and composes from the rest (AC-4, AC-5). This is
    //    the ONE place `getForPr({ summary: true })` (one LLM call) is
    //    invoked — only on the confirmed compose path (see module doc).
    let blast: BlastRadiusResult | null = null;
    try {
      const result = await this.blastService.getForPr(prId, workspaceId, { summary: true });
      blast = result;
      if (result.degraded) {
        degradedInputs.push(`blast_degraded:${result.reason ?? 'unknown'}`);
      }
    } catch (err) {
      degradedInputs.push(
        `blast_degraded:${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    // 7. References — best-effort resolve via container.git / a best-effort
    //    GitHub client / webFetch gated by the external-fetch flag (AC-6, AC-48).
    const repoRef = { owner: repoRow.owner, name: repoRow.name };
    const github = await this.container.github().catch(() => null);
    const webFetch = this.container.config.externalFetchEnabled ? this.container.webFetch : null;
    const parsedRefs = parseReferences(pull.body, repoRef);
    const references = await resolveReferences(parsedRefs, {
      repoRef,
      git: this.container.git,
      github,
      webFetch,
      logger: this.logger,
    });

    // 7b. Extract the first linked issue as a dedicated `issue` parameter for
    //     the composer — mirrors `intent/service.ts:138-164`. The resolved
    //     `references` array already carries GitHub issue content folded into
    //     `## Referenced plans/specs`, but the composer/prompt also has a
    //     DEDICATED `## Linked issue` section (prompt.ts) that only fires when
    //     this `issue` param is populated — without this, that section never
    //     fires in production even though it's fully implemented and tested.
    //     Best-effort: use the first github ref if available; a fetch failure
    //     (404, no PAT) just skips the section, never fails compose (AC-6).
    let issue: { title: string; body: string | null } | null = null;
    if (github) {
      const firstGithubRef = parsedRefs.find((r) => r.kind === 'github');
      if (firstGithubRef?.issueNumber != null) {
        const n = firstGithubRef.issueNumber;
        const targetRef =
          firstGithubRef.targetOwner && firstGithubRef.targetRepo
            ? { owner: firstGithubRef.targetOwner, name: firstGithubRef.targetRepo }
            : repoRef;
        try {
          const fetched = await github.getIssue(targetRef, n);
          issue = { title: fetched.title, body: fetched.body ?? null };
        } catch {
          // Fall back to getPullRequest on 404 (the reference may point at a PR).
          try {
            const pr = await github.getPullRequest(targetRef, n);
            issue = { title: pr.title, body: pr.body ?? null };
          } catch {
            // Best-effort: skip the linked issue if both fetches fail.
          }
        }
      }
    }

    const llm = await this.container.llm(provider);

    // 11. Compose → ground → persist only after a successful call, so a
    //     provider error leaves the previously stored envelope intact (AC-32).
    const composed = await composeBrief({
      title: pull.title,
      author: pull.author,
      branch: pull.branch,
      base: pull.base,
      body: pull.body,
      diffStats,
      diff,
      intent,
      blast,
      issue,
      references,
      llm,
      model,
      provider,
      logger: this.logger,
    });

    const sets = citableSets(changedPaths, blast);
    const { brief: groundedBrief, stats } = groundBrief(composed.raw, sets);

    this.logger?.info(
      {
        prId,
        risksIn: stats.risksIn,
        risksOut: stats.risksOut,
        focusIn: stats.focusIn,
        focusOut: stats.focusOut,
      },
      `brief: grounding kept ${stats.risksOut}/${stats.risksIn} risk(s), ${stats.focusOut}/${stats.focusIn} focus entr(y/ies)`,
    );

    const envelope: BriefEnvelope = {
      schema_version: BRIEF_SCHEMA_VERSION,
      state_key: stateKey,
      head_sha: pull.headSha,
      generated_at: new Date().toISOString(),
      provider,
      model,
      degraded_inputs: degradedInputs,
      blast_fingerprint: blast ? fingerprintBlast(blast) : null,
      tokens: { header_only: composed.tokens.headerOnly, full_diff: composed.tokens.fullDiff },
      brief: groundedBrief,
    };

    await this.briefRepo.upsertEnvelope(prId, envelope);

    return envelopeToResponse(envelope);
  }
}

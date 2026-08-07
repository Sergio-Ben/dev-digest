import type {
  ConventionCandidate,
  ConventionsPayload,
  ConventionSkillDraft,
  Skill,
} from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveFeatureModel } from '../settings/feature-models.js';
import { SkillsService } from '../skills/service.js';
import { ConventionsRepository, type InsertCandidate } from './repository.js';
import { collectSamples } from './sampler.js';
import { verifyEvidence } from './verify.js';
import { buildSkillDraft } from './skill-body.js';
import {
  ConventionExtraction,
  conventionsSystemPrompt,
  conventionsUserPrompt,
} from './prompt.js';
import { MIN_CONFIDENCE } from './constants.js';
import { normaliseCategory, toCandidateDto, toScanDto } from './helpers.js';

export interface CreateConventionSkillInput {
  name: string;
  description?: string;
  body: string;
  enabled?: boolean;
  type?: 'rubric' | 'convention' | 'security' | 'custom';
  agentId?: string;
}

/**
 * Conventions extractor.
 *
 * ONE model call per scan: file selection is pure code (sampler), and every
 * candidate the model returns is re-verified against the sampled contents
 * before it is persisted (verify.ts). Extraction is synchronous — the client
 * shows a pending button rather than polling a job.
 */
export class ConventionsService {
  private repo: ConventionsRepository;

  constructor(private container: Container) {
    this.repo = container.conventionsRepo;
  }

  async list(workspaceId: string, repoId: string): Promise<ConventionsPayload> {
    const [scan, rows] = await Promise.all([
      this.repo.latestScan(workspaceId, repoId),
      this.repo.listByRepo(workspaceId, repoId),
    ]);
    return {
      scan: scan ? toScanDto(scan) : null,
      candidates: rows.map(toCandidateDto),
    };
  }

  async extract(workspaceId: string, repoId: string): Promise<ConventionsPayload> {
    const samples = await collectSamples(this.container, workspaceId, repoId);
    if (!samples) throw new NotFoundError('Repo not found');
    if (samples.files.length === 0) {
      throw new ValidationError(
        'No files could be sampled for this repo — clone and index it first.',
      );
    }

    const choice = await resolveFeatureModel(this.container, workspaceId, 'conventions');
    const llm = await this.container.llm(choice.provider);
    const result = await llm.completeStructured({
      model: choice.model,
      schema: ConventionExtraction,
      schemaName: 'ConventionExtraction',
      messages: [
        { role: 'system', content: await conventionsSystemPrompt() },
        {
          role: 'user',
          content: conventionsUserPrompt(samples.repoFullName, samples.files),
        },
      ],
    });

    // Verify against the sampled contents ALREADY IN MEMORY — not a fresh git
    // read. That is cheaper, and it guarantees the model cannot cite a file it
    // was never shown.
    const byPath = new Map(samples.files.map((f) => [f.path, f.content]));
    const verified: InsertCandidate[] = [];
    let dropped = 0;

    for (const c of result.data.candidates) {
      if (c.confidence < MIN_CONFIDENCE) {
        dropped++;
        continue;
      }
      const check = verifyEvidence(c.evidence_snippet, byPath.get(c.evidence_path) ?? null);
      if (!check.ok) {
        dropped++;
        continue;
      }
      verified.push({
        category: normaliseCategory(c.category),
        rule: c.rule.trim(),
        evidencePath: c.evidence_path,
        evidenceSnippet: c.evidence_snippet,
        evidenceStartLine: check.startLine!,
        evidenceEndLine: check.endLine!,
        confidence: c.confidence,
      });
    }

    const scan = await this.repo.insertScan({
      workspaceId,
      repoId,
      sampleCount: samples.files.length,
      candidateCount: verified.length,
      droppedCount: dropped,
      provider: choice.provider,
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    });
    await this.repo.replacePending(workspaceId, repoId, scan.id, verified);

    return this.list(workspaceId, repoId);
  }

  async patch(
    workspaceId: string,
    id: string,
    input: { rule?: string; category?: string | null; status?: 'pending' | 'accepted' | 'rejected' },
  ): Promise<ConventionCandidate | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(input.rule !== undefined ? { rule: input.rule } : {}),
      ...(input.category !== undefined
        ? { category: normaliseCategory(input.category) }
        : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    });
    return row ? toCandidateDto(row) : undefined;
  }

  /** The generated draft. The client may edit every field before posting back. */
  async skillDraft(workspaceId: string, repoId: string): Promise<ConventionSkillDraft> {
    const accepted = await this.acceptedCandidates(workspaceId, repoId);
    if (accepted.candidates.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill.');
    }
    return buildSkillDraft(accepted.repoName, accepted.candidates);
  }

  /**
   * Create the skill from what the user submitted (NOT regenerated), stamp its
   * evidence files, optionally link it to an agent, and mark the source
   * candidates as consumed — one place, so all four stay in step.
   */
  async createSkill(
    workspaceId: string,
    repoId: string,
    input: CreateConventionSkillInput,
  ): Promise<Skill> {
    const accepted = await this.acceptedCandidates(workspaceId, repoId);
    if (accepted.candidates.length === 0) {
      throw new ValidationError('Accept at least one convention before creating a skill.');
    }
    const draft = buildSkillDraft(accepted.repoName, accepted.candidates);

    const skills = new SkillsService(this.container);
    const skill = await skills.create(workspaceId, {
      name: input.name,
      description: input.description ?? draft.description,
      type: input.type ?? 'convention',
      source: 'extracted',
      body: input.body,
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      evidenceFiles: draft.evidence_files,
    });

    if (input.agentId) {
      const linked = await this.container.agentsRepo.skillIdsForAgent(input.agentId);
      await this.container.agentsRepo.linkSkill(input.agentId, skill.id, linked.length);
    }
    await this.repo.markLinked(
      workspaceId,
      accepted.candidates.map((c) => c.id),
      skill.id,
    );
    return skill;
  }

  private async acceptedCandidates(
    workspaceId: string,
    repoId: string,
  ): Promise<{ repoName: string; candidates: ConventionCandidate[] }> {
    const repo = await this.repo.getRepo(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    const rows = await this.repo.listByRepo(workspaceId, repoId);
    return {
      repoName: repo.name,
      candidates: rows.filter((r) => r.status === 'accepted').map(toCandidateDto),
    };
  }
}

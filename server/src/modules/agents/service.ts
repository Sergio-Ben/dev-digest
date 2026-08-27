import type { Container } from '../../platform/container.js';
import type { Agent, AgentSkillLink, AgentVersion, CiFailOn, ModelInfo, Provider, ReviewStrategy } from '@devdigest/shared';
import { AgentVersionConfig } from '@devdigest/shared';
import { AgentsRepository } from './repository.js';
import { toAgentDto, toAgentVersionDto } from './helpers.js';
import { NotFoundError } from '../../platform/errors.js';

/**
 * A2 — agents service. Business logic for the Agents tab + Agent Editor.
 * Provider/model selection uses the LLM adapter's dynamic model list.
 *
 * An Agent = provider + model + system_prompt + linked skills + output_schema +
 * enabled. Config changes are versioned via `agent_versions` (repository).
 */

// Re-exported for backwards compatibility; implementation lives in ./helpers.
export { toAgentDto } from './helpers.js';

export interface CreateAgentInput {
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  system_prompt: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  system_prompt?: string;
  output_schema?: unknown;
  strategy?: ReviewStrategy;
  ci_fail_on?: CiFailOn;
  repo_intel?: boolean;
  enabled?: boolean;
}

export class AgentsService {
  private repo: AgentsRepository;

  constructor(private container: Container) {
    this.repo = new AgentsRepository(container.db);
  }

  async list(workspaceId: string): Promise<Agent[]> {
    const rows = await this.repo.list(workspaceId);
    // Attach skill_count to each agent (one extra query for all agents).
    const skillCounts = await this.repo.skillCountsForWorkspace(workspaceId);
    return rows.map((row) => ({ ...toAgentDto(row), skill_count: skillCounts.get(row.id) ?? 0 }));
  }

  async get(workspaceId: string, id: string): Promise<Agent | undefined> {
    const row = await this.repo.getById(workspaceId, id);
    if (!row) return undefined;
    const skillCount = await this.repo.skillCount(id);
    return { ...toAgentDto(row), skill_count: skillCount };
  }

  /** Delete an agent (and its versions/skill-links, via cascade). */
  async delete(workspaceId: string, id: string): Promise<boolean> {
    return this.repo.deleteById(workspaceId, id);
  }

  /**
   * Config snapshots for an agent, newest version first. Workspace-scoped:
   * returns `undefined` (→ 404 at the route) when the agent isn't in this
   * workspace, since `repo.listVersions()` is keyed by agent id alone.
   */
  async listVersions(workspaceId: string, id: string): Promise<AgentVersion[] | undefined> {
    const agent = await this.repo.getById(workspaceId, id);
    if (!agent) return undefined;
    const rows = await this.repo.listVersions(id);
    return rows.map(toAgentVersionDto);
  }

  /**
   * A single config snapshot for an agent. `undefined` (→ 404) when the agent
   * isn't in this workspace OR that version was never recorded.
   */
  async getVersion(
    workspaceId: string,
    id: string,
    version: number,
  ): Promise<AgentVersion | undefined> {
    const agent = await this.repo.getById(workspaceId, id);
    if (!agent) return undefined;
    const row = await this.repo.getVersion(id, version);
    return row ? toAgentVersionDto(row) : undefined;
  }

  async create(workspaceId: string, input: CreateAgentInput, userId?: string): Promise<Agent> {
    const row = await this.repo.insert({
      workspaceId,
      name: input.name,
      description: input.description,
      provider: input.provider,
      model: input.model,
      systemPrompt: input.system_prompt,
      outputSchema: input.output_schema,
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.ci_fail_on !== undefined ? { ciFailOn: input.ci_fail_on } : {}),
      ...(input.repo_intel !== undefined ? { repoIntel: input.repo_intel } : {}),
      enabled: input.enabled,
      createdBy: userId ?? null,
    });
    return toAgentDto(row);
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgentInput,
  ): Promise<Agent | undefined> {
    const row = await this.repo.update(workspaceId, id, {
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
      ...(patch.model !== undefined ? { model: patch.model } : {}),
      ...(patch.system_prompt !== undefined ? { systemPrompt: patch.system_prompt } : {}),
      ...(patch.output_schema !== undefined ? { outputSchema: patch.output_schema } : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.ci_fail_on !== undefined ? { ciFailOn: patch.ci_fail_on } : {}),
      ...(patch.repo_intel !== undefined ? { repoIntel: patch.repo_intel } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    });
    return row ? toAgentDto(row) : undefined;
  }

  /**
   * Persist an ordered list of repo-relative markdown paths as the agent's
   * attached context documents. Does NOT bump version (AC-14). Array order IS
   * the attach order (AC-10). Returns the updated Agent DTO, or undefined if
   * the agent is not found in the workspace.
   */
  async setAttachedDocs(
    workspaceId: string,
    id: string,
    paths: string[],
  ): Promise<Agent | undefined> {
    const row = await this.repo.setAttachedDocs(workspaceId, id, paths);
    if (!row) return undefined;
    const skillCount = await this.repo.skillCount(id);
    return { ...toAgentDto(row), skill_count: skillCount };
  }

  /** Linked skills for an agent as AgentSkillLink[] (ordered). */
  async skillLinks(agentId: string): Promise<AgentSkillLink[]> {
    const links = await this.repo.linkedSkills(agentId);
    return links.map((l) => ({ agent_id: agentId, skill_id: l.skill.id, order: l.order }));
  }

  /**
   * Set / reorder the agent's linked skills. If `skillIds` is provided, replaces
   * the whole set in that order. Returns the resulting ordered links.
   */
  async setSkills(
    workspaceId: string,
    agentId: string,
    skillIds: string[],
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    await this.repo.setSkills(agentId, skillIds);
    return this.skillLinks(agentId);
  }

  /** Link a single skill (append or set order) — additive to existing links. */
  async linkSkill(
    workspaceId: string,
    agentId: string,
    skillId: string,
    order?: number,
  ): Promise<AgentSkillLink[] | undefined> {
    const agent = await this.repo.getById(workspaceId, agentId);
    if (!agent) return undefined;
    const existing = await this.repo.linkedSkills(agentId);
    const resolvedOrder = order ?? existing.length;
    await this.repo.linkSkill(agentId, skillId, resolvedOrder);
    return this.skillLinks(agentId);
  }

  /**
   * Promote vN (Q5) — reset the agent's LIVE config to a past `agent_versions`
   * snapshot. Non-destructive / forward-only: it does NOT rewrite the snapshot
   * row or any historical version. Instead it feeds the snapshot's config back
   * through the existing `update()`, which bumps to a brand-new version whose
   * config equals vN's and snapshots it again (so history keeps growing
   * forward, never mutated in place).
   *
   * Throws `NotFoundError` (AC-40) when the snapshot doesn't exist OR the
   * agent isn't in this workspace.
   *
   * Critical trap (verified in code): `update()` never touches `agent_skills`,
   * so the snapshot's skill links must be re-applied explicitly via
   * `setSkills()` — otherwise the promoted agent silently keeps whatever
   * skills happen to be linked right now.
   */
  async promoteToVersion(workspaceId: string, id: string, version: number): Promise<Agent> {
    const snapshot = await this.repo.getVersion(id, version);
    if (!snapshot) throw new NotFoundError('Agent version not found');

    // Workspace-scope check: getVersion() is not workspace-scoped by itself.
    const agent = await this.repo.getById(workspaceId, id);
    if (!agent) throw new NotFoundError('Agent not found');

    const config = AgentVersionConfig.parse(snapshot.configJson);

    // update()/isConfigChange() bump the version on ANY explicitly-passed
    // output_schema (it isn't deep-compared — see helpers.ts#isConfigChange),
    // so it's only included in the patch when it actually differs from the
    // live agent's current output_schema. That keeps the promote call
    // idempotent: when every field (including output_schema) already equals
    // the live config, isConfigChange() sees no delta and update() doesn't
    // bump the version — the call still succeeds and returns the current
    // agent.
    const outputSchemaChanged =
      JSON.stringify(config.output_schema ?? null) !== JSON.stringify(agent.outputSchema ?? null);

    // Re-apply the snapshot's skill links FIRST — update() does NOT touch
    // agent_skills, and the new version it snapshots records the agent's LIVE
    // skills (repository.snapshotVersion reads them). Applying set A before the
    // config bump means the forward v(N+1) snapshot captures skills = A, not
    // whatever was linked right before promoting.
    const links = await this.setSkills(workspaceId, id, config.skills);
    if (!links) throw new NotFoundError('Agent not found');

    const updated = await this.update(workspaceId, id, {
      provider: config.provider,
      model: config.model,
      system_prompt: config.system_prompt,
      ...(outputSchemaChanged ? { output_schema: config.output_schema } : {}),
      strategy: config.strategy,
      ci_fail_on: config.ci_fail_on,
      repo_intel: config.repo_intel,
    });
    if (!updated) throw new NotFoundError('Agent not found');

    // Re-fetch so the returned DTO carries an accurate skill_count (update()'s
    // own return value doesn't compute it).
    const fresh = await this.get(workspaceId, id);
    if (!fresh) throw new NotFoundError('Agent not found');
    return fresh;
  }

  /**
   * Dynamic model list from the provider adapter's /models. Degrades gracefully
   * to [] if the provider key is not configured (the editor still renders).
   */
  async listModels(provider: Provider): Promise<ModelInfo[]> {
    try {
      const llm = await this.container.llm(provider);
      return await llm.listModels();
    } catch {
      return [];
    }
  }
}

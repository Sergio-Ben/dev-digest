import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-promote] Docker not available — skipping integration tests.');
}

/**
 * Promote vN (Q5, T17) — POST /agents/:id/promote resets an agent's LIVE
 * config to a past `agent_versions` snapshot by feeding the snapshot's config
 * back through the existing `update()` (forward-only: a NEW version is
 * created, nothing is mutated in place), and re-applies the snapshot's linked
 * skills via `setSkills()` — the verified trap: `update()` alone never
 * touches `agent_skills`.
 */
d('POST /agents/:id/promote', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  async function insertSkill(name: string) {
    const { db } = pg.handle;
    const [{ id: workspaceId }] = await db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    const [skill] = await db
      .insert(t.skills)
      .values({
        workspaceId: workspaceId!,
        name,
        description: name,
        type: 'custom',
        source: 'manual',
        body: `# ${name}`,
      })
      .returning();
    return skill!.id as string;
  }

  it(
    're-applies both config AND skill links from the snapshot (the agent_skills trap), and grows a NEW forward version',
    async () => {
      const skillA = await insertSkill('Skill A');
      const skillB = await insertSkill('Skill B');

      const app = await makeApp();

      // v1: create with skill set A.
      const created = await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Promote Target',
          provider: 'openai',
          model: 'gpt-4o-mini',
          system_prompt: 'Review the diff.',
        },
      });
      expect(created.statusCode).toBe(201);
      const agentId = created.json().id as string;

      await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/skills`,
        payload: { skill_ids: [skillA] },
      });

      // v2: config-affecting edit (model) → snapshot v2 = { model: gpt-4o, skills: [A] }.
      const v2 = await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}`,
        payload: { model: 'gpt-4o' },
      });
      expect(v2.statusCode).toBe(200);
      expect(v2.json().version).toBe(2);

      // Swap to skill set B (does NOT itself bump version — only config edits do).
      await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/skills`,
        payload: { skill_ids: [skillB] },
      });

      // v3: another config-affecting edit → snapshot v3 = { model: gpt-4o-2024, skills: [B] }.
      const v3 = await app.inject({
        method: 'PUT',
        url: `/agents/${agentId}`,
        payload: { model: 'gpt-4o-2024-11-20' },
      });
      expect(v3.statusCode).toBe(200);
      expect(v3.json().version).toBe(3);

      // Live agent right now: v3 config (gpt-4o-2024-11-20) + skill set B.
      const beforePromoteSkills = await app.inject({
        method: 'GET',
        url: `/agents/${agentId}/skills`,
      });
      expect(beforePromoteSkills.json().map((l: { skill_id: string }) => l.skill_id)).toEqual([
        skillB,
      ]);

      // Promote v2 — should reset live config to v2's snapshot AND re-apply skill set A.
      const promoted = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/promote`,
        payload: { version: 2 },
      });
      expect(promoted.statusCode).toBe(200);
      const promotedAgent = promoted.json();
      expect(promotedAgent.model).toBe('gpt-4o');
      // Forward-only: a NEW version (v4) is created, not a revert to v2 in place.
      expect(promotedAgent.version).toBe(4);

      // The live agent config now matches v2's snapshot.
      const live = await app.inject({ method: 'GET', url: `/agents/${agentId}` });
      expect(live.json().model).toBe('gpt-4o');
      expect(live.json().version).toBe(4);

      // THE CRITICAL TRAP: agent_skills must be re-applied to v2's skill set (A),
      // not silently left at whatever was linked right before promoting (B).
      const afterPromoteSkills = await app.inject({
        method: 'GET',
        url: `/agents/${agentId}/skills`,
      });
      expect(afterPromoteSkills.json().map((l: { skill_id: string }) => l.skill_id)).toEqual([
        skillA,
      ]);

      // A brand-new forward version row (v4) exists whose config equals v2's snapshot,
      // and the old v1-v3 rows are untouched (non-destructive history).
      const repo = new AgentsRepository(pg.handle.db);
      const v4Snapshot = await repo.getVersion(agentId, 4);
      expect(v4Snapshot).toBeDefined();
      expect(v4Snapshot!.configJson).toMatchObject({ model: 'gpt-4o', skills: [skillA] });
      const allVersions = await repo.listVersions(agentId);
      expect(allVersions.map((v) => v.version)).toEqual([4, 3, 2, 1]);

      await app.close();
    },
  );

  it('is idempotent when the snapshot config already equals the live config', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Idempotent Promote',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    const agentId = created.json().id as string;

    // Promoting v1 while the live config still equals v1's snapshot should
    // succeed and NOT bump the version (isConfigChange sees no delta on any
    // field, including output_schema — which is only forwarded when it
    // actually differs from the live value, precisely so this stays a no-op).
    const promoted = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/promote`,
      payload: { version: 1 },
    });
    expect(promoted.statusCode).toBe(200);
    expect(promoted.json().model).toBe('gpt-4o-mini');
    expect(promoted.json().version).toBe(1);
    await app.close();
  });

  it('404s for an unknown version and a cross-workspace agent (AC-40)', async () => {
    const app = await makeApp();
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Promote 404s',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    const agentId = created.json().id as string;

    const unknownVersion = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/promote`,
      payload: { version: 99 },
    });
    expect(unknownVersion.statusCode).toBe(404);

    const ghost = '00000000-0000-0000-0000-000000000000';
    const unknownAgent = await app.inject({
      method: 'POST',
      url: `/agents/${ghost}/promote`,
      payload: { version: 1 },
    });
    expect(unknownAgent.statusCode).toBe(404);

    // Cross-workspace: a version snapshot that exists, but for an agent owned
    // by a different workspace than the request context.
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-promote' }).returning();
    const repo = new AgentsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const crossWorkspace = await app.inject({
      method: 'POST',
      url: `/agents/${foreign.id}/promote`,
      payload: { version: 1 },
    });
    expect(crossWorkspace.statusCode).toBe(404);

    await app.close();
  });
});

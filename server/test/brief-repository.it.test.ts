import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { BriefRepository } from '../src/modules/brief/repository.js';
import { BRIEF_SCHEMA_VERSION } from '../src/modules/brief/constants.js';
import type { BriefEnvelope } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** A valid current-version envelope, used for the round-trip assertion. */
const ENVELOPE: BriefEnvelope = {
  schema_version: BRIEF_SCHEMA_VERSION,
  state_key: 'state-abc123',
  head_sha: 'a1b2c3d4',
  generated_at: '2026-08-18T00:00:00.000Z',
  provider: 'openai',
  model: 'gpt-5',
  degraded_inputs: [],
  blast_fingerprint: 'fp-1',
  tokens: { header_only: 1300, full_diff: 8200 },
  brief: {
    what: 'Adds rate limiting middleware.',
    why: 'Prevents abuse of the public API.',
    risk_level: 'medium',
    risks: [
      {
        kind: 'security',
        title: 'Missing auth check',
        explanation: 'The new endpoint skips the auth middleware.',
        severity: 'medium',
        file_refs: ['src/config.ts'],
        endpoint_refs: [],
      },
    ],
    review_focus: [
      {
        file: 'src/config.ts',
        line: 11,
        reason: 'Hardcoded secret introduced here.',
        endpoint_ref: null,
      },
    ],
  },
};

d('BriefRepository (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    const [ws] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'acme' })
      .returning();
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  async function createPr() {
    const name = `payments-api-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    return pr!.id as string;
  }

  it('treats a stored envelope with a stale schema_version as a cache miss, without throwing', async () => {
    const repo = new BriefRepository(pg.handle.db);
    const prId = await createPr();

    // Insert directly (bypassing upsertEnvelope, which always writes the current
    // version) to simulate a row persisted under an older schema shape.
    await pg.handle.db
      .insert(t.prBrief)
      .values({ prId, json: { ...ENVELOPE, schema_version: 0 } });

    await expect(repo.getEnvelope(prId)).resolves.toBeUndefined();
  });

  it('round-trips a current-version envelope through upsertEnvelope/getEnvelope', async () => {
    const repo = new BriefRepository(pg.handle.db);
    const prId = await createPr();

    await repo.upsertEnvelope(prId, ENVELOPE);
    const result = await repo.getEnvelope(prId);

    expect(result).toEqual(ENVELOPE);
  });
});

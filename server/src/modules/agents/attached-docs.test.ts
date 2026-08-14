/**
 * Hermetic unit tests for AgentsRepository.setAttachedDocs (AC-9/AC-10/AC-14)
 *
 * AC-9:  setAttachedDocs persists the ordered array of paths
 * AC-10: array order IS the attach order
 * AC-14: setAttachedDocs NEVER touches `version` — does a targeted update
 *
 * These tests mock the Drizzle `db` object at the chain level (same pattern as
 * run.repo.severity.test.ts). No Docker, no real Postgres.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { AgentsRepository } from './repository.js';
import type { Db } from '../../db/client.js';

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal AgentRow returned by Drizzle .returning() after the update. */
function agentRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'agent-1',
    workspaceId: 'ws-1',
    name: 'My Agent',
    description: '',
    provider: 'openai',
    model: 'gpt-4.1',
    systemPrompt: 'You are helpful.',
    outputSchema: null,
    strategy: 'single-pass',
    ciFailOn: 'critical',
    repoIntel: true,
    attachedDocPaths: [] as string[],
    enabled: true,
    version: 3,           // purposely non-default to assert version is not changed
    createdBy: null,
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Build a mock Drizzle db whose `update().set().where().returning()` chain
 * resolves with the provided row.  Captures the `set()` argument for assertions.
 */
function makeDb(returnedRow: unknown) {
  const setCalls: unknown[] = [];
  const chain = {
    set: vi.fn((args: unknown) => { setCalls.push(args); return chain; }),
    where: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue([returnedRow]),
  };
  const db = {
    update: vi.fn().mockReturnValue(chain),
    _setCalls: setCalls,
    _chain: chain,
  } as unknown as Db & { _setCalls: unknown[]; _chain: typeof chain };
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AgentsRepository.setAttachedDocs', () => {
  it('persists the ordered array of paths (AC-9/AC-10)', async () => {
    const paths = ['docs/architecture.md', 'specs/api.md'];
    const returnRow = agentRow({ attachedDocPaths: paths });
    const db = makeDb(returnRow);
    const repo = new AgentsRepository(db as unknown as Db);

    const result = await repo.setAttachedDocs('ws-1', 'agent-1', paths);

    // the returned row carries the exact paths array
    expect(result?.attachedDocPaths).toEqual(paths);
    // array order is the attach order
    expect(result?.attachedDocPaths?.[0]).toBe('docs/architecture.md');
    expect(result?.attachedDocPaths?.[1]).toBe('specs/api.md');
  });

  it('does NOT include `version` in the set() payload (AC-14)', async () => {
    const paths = ['specs/design.md'];
    const db = makeDb(agentRow({ attachedDocPaths: paths }));
    const repo = new AgentsRepository(db as unknown as Db);

    await repo.setAttachedDocs('ws-1', 'agent-1', paths);

    // the set() payload must only contain attachedDocPaths — never version
    const setPayload = (db as unknown as { _setCalls: unknown[] })._setCalls[0] as Record<string, unknown>;
    expect(setPayload).toBeDefined();
    expect(Object.keys(setPayload)).toContain('attachedDocPaths');
    expect(Object.keys(setPayload)).not.toContain('version');
  });

  it('persists the reordered array when paths order changes', async () => {
    const reorderedPaths = ['specs/api.md', 'docs/architecture.md'];
    const db = makeDb(agentRow({ attachedDocPaths: reorderedPaths }));
    const repo = new AgentsRepository(db as unknown as Db);

    const result = await repo.setAttachedDocs('ws-1', 'agent-1', reorderedPaths);

    // reorder persists the new order
    expect(result?.attachedDocPaths?.[0]).toBe('specs/api.md');
    expect(result?.attachedDocPaths?.[1]).toBe('docs/architecture.md');
  });

  it('persists an empty array (clearing all attached docs)', async () => {
    const db = makeDb(agentRow({ attachedDocPaths: [] }));
    const repo = new AgentsRepository(db as unknown as Db);

    const result = await repo.setAttachedDocs('ws-1', 'agent-1', []);

    // empty array persisted correctly
    expect(result?.attachedDocPaths).toEqual([]);
  });

  it('returns undefined when agent is not found', async () => {
    // Drizzle update returns empty array when no row matched
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    const db = { update: vi.fn().mockReturnValue(chain) } as unknown as Db;
    const repo = new AgentsRepository(db);

    const result = await repo.setAttachedDocs('ws-1', 'nonexistent', ['a.md']);

    // no row matched → undefined
    expect(result).toBeUndefined();
  });
});

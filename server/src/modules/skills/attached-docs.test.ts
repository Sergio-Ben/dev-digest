/**
 * Hermetic unit tests for SkillsRepository.setAttachedDocs (AC-14/AC-16)
 *
 * AC-14: setAttachedDocs NEVER touches `version`, `evidence_files`, or `threat_level`
 * AC-16: persists ordered paths on a skill
 *
 * Follows the same Drizzle db-mock pattern as run.repo.severity.test.ts.
 * No Docker, no real Postgres.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SkillsRepository } from './repository.js';
import type { Db } from '../../db/client.js';

afterEach(() => vi.restoreAllMocks());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal SkillRow returned by Drizzle .returning() after the update. */
function skillRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'skill-1',
    workspaceId: 'ws-1',
    name: 'No Secrets',
    description: 'Do not commit secrets.',
    type: 'security',
    source: 'manual',
    body: 'Rule: no secrets.',
    enabled: true,
    version: 2,              // non-default; must stay untouched
    evidenceFiles: ['file.ts'], // must stay untouched
    attachedDocPaths: [] as string[],
    threatLevel: 'safe',     // must stay untouched
    createdAt: new Date('2026-06-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Build a mock Drizzle db whose `update().set().where().returning()` chain
 * resolves with the provided row.  Captures the `set()` argument.
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
  } as unknown as Db & { _setCalls: unknown[] };
  return db;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SkillsRepository.setAttachedDocs', () => {
  it('persists the ordered paths array (AC-16)', async () => {
    const paths = ['docs/arch.md', 'specs/security.md'];
    const db = makeDb(skillRow({ attachedDocPaths: paths }));
    const repo = new SkillsRepository(db as unknown as Db);

    const result = await repo.setAttachedDocs('ws-1', 'skill-1', paths);

    // ordered paths are persisted
    expect(result?.attachedDocPaths).toEqual(paths);
    expect(result?.attachedDocPaths?.[0]).toBe('docs/arch.md');
    expect(result?.attachedDocPaths?.[1]).toBe('specs/security.md');
  });

  it('does NOT include version in the set() payload (AC-14)', async () => {
    const paths = ['docs/arch.md'];
    const db = makeDb(skillRow({ attachedDocPaths: paths }));
    const repo = new SkillsRepository(db as unknown as Db);

    await repo.setAttachedDocs('ws-1', 'skill-1', paths);

    const setPayload = (db as unknown as { _setCalls: unknown[] })._setCalls[0] as Record<string, unknown>;
    // version must NOT appear in the targeted update
    expect(Object.keys(setPayload)).not.toContain('version');
    expect(Object.keys(setPayload)).toContain('attachedDocPaths');
  });

  it('does NOT include evidenceFiles in the set() payload (AC-14)', async () => {
    const paths = ['docs/arch.md'];
    const db = makeDb(skillRow({ attachedDocPaths: paths }));
    const repo = new SkillsRepository(db as unknown as Db);

    await repo.setAttachedDocs('ws-1', 'skill-1', paths);

    const setPayload = (db as unknown as { _setCalls: unknown[] })._setCalls[0] as Record<string, unknown>;
    // evidence_files must NOT be touched
    expect(Object.keys(setPayload)).not.toContain('evidenceFiles');
    expect(Object.keys(setPayload)).not.toContain('evidence_files');
  });

  it('does NOT include threatLevel in the set() payload (AC-14)', async () => {
    const paths = ['docs/arch.md'];
    const db = makeDb(skillRow({ attachedDocPaths: paths }));
    const repo = new SkillsRepository(db as unknown as Db);

    await repo.setAttachedDocs('ws-1', 'skill-1', paths);

    const setPayload = (db as unknown as { _setCalls: unknown[] })._setCalls[0] as Record<string, unknown>;
    // threat_level must NOT be touched by this update
    expect(Object.keys(setPayload)).not.toContain('threatLevel');
    expect(Object.keys(setPayload)).not.toContain('threat_level');
  });

  it('reorder persists the new order', async () => {
    const reordered = ['specs/security.md', 'docs/arch.md'];
    const db = makeDb(skillRow({ attachedDocPaths: reordered }));
    const repo = new SkillsRepository(db as unknown as Db);

    const result = await repo.setAttachedDocs('ws-1', 'skill-1', reordered);

    expect(result?.attachedDocPaths?.[0]).toBe('specs/security.md');
    expect(result?.attachedDocPaths?.[1]).toBe('docs/arch.md');
  });

  it('returns undefined when skill is not found in workspace', async () => {
    const chain = {
      set: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      returning: vi.fn().mockResolvedValue([]),
    };
    const db = { update: vi.fn().mockReturnValue(chain) } as unknown as Db;
    const repo = new SkillsRepository(db);

    const result = await repo.setAttachedDocs('ws-1', 'nonexistent', ['a.md']);

    // no row matched → undefined
    expect(result).toBeUndefined();
  });
});

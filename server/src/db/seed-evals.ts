import type { Db } from './client.js';
import * as t from './schema.js';
import { and, eq } from 'drizzle-orm';
import { EvalsRepository } from '../modules/evals/repository.js';

/**
 * T16 — gold-set seed for the "Security Reviewer" agent (AC-44 sensitivity
 * experiment). Additive, own file (never edits `seed.ts`): attaches two eval
 * cases to the "Security Reviewer" agent already created by `seed()` —
 *
 *  - an ACCEPTED "stripe-key-leak" case (`must_find`): a real Stripe secret
 *    key committed on `src/config.ts:12` — reuses the exact same patch text
 *    as PR #482's `src/config.ts` file in `seed.ts` so the finding location
 *    is battle-tested, not a one-off fixture.
 *  - a DISMISSED "clean-refactor" case (`must_not_flag`): a type-annotation
 *    refactor with zero security concerns — `expected_output: []`, so ANY
 *    finding the agent produces on this case is pure noise (AC-24 vacuous
 *    recall/precision when the model stays silent, as it should).
 *
 * Idempotent — safe to call multiple times (checked by case name, mirrors
 * `seed()`'s upsert-by-name pattern). Must run AFTER `seed()` — it looks up
 * the "Security Reviewer" agent by name and throws if it's missing rather
 * than silently creating a divergent one.
 */

export const SECURITY_REVIEWER_NAME = 'Security Reviewer';

export const STRIPE_LEAK_CASE_NAME = 'stripe-key-leak (accepted)';
export const CLEAN_REFACTOR_CASE_NAME = 'clean-refactor (dismissed)';

/** File + line the accepted case's expected finding cites — reused by the
 *  T16 integration test to build matching/non-matching mock fixtures. */
export const STRIPE_LEAK_FILE = 'src/config.ts';
export const STRIPE_LEAK_LINE = 12;
/** A second, real line inside the SAME hunk — used by the test to construct
 *  a "noise" finding that still survives citation-grounding (the line is
 *  covered by the hunk) but does not match the expected finding's range. */
export const STRIPE_LEAK_NOISE_LINE = 10;

export const CLEAN_REFACTOR_FILE = 'src/utils/format.ts';

// Identical to PR #482's `src/config.ts` patch in `seed.ts` — the `sk_live_`
// literal lands on new-side line 12 (blank=9, `export const config = {`=10,
// `port: ...`=11, +4 new lines=12-15, `redisUrl: ...`=16, `};`=17).
export const STRIPE_LEAK_DIFF = [
  'diff --git a/src/config.ts b/src/config.ts',
  '--- a/src/config.ts',
  '+++ b/src/config.ts',
  '@@ -9,5 +9,9 @@',
  ' ',
  ' export const config = {',
  '   port: Number(process.env.PORT ?? 3000),',
  '+  stripeKey: "sk_live_51H8xq2Ka9Vn3PqLm7Rd0bZ4Xc",',
  '+  rateLimit: {',
  '+    windowSec: 3600,',
  '+  },',
  '   redisUrl: process.env.REDIS_URL,',
  ' };',
].join('\n');

export const STRIPE_LEAK_EXPECTED = [
  {
    severity: 'CRITICAL',
    category: 'security',
    title: 'Hardcoded Stripe secret key in commit',
    file: STRIPE_LEAK_FILE,
    start_line: STRIPE_LEAK_LINE,
    end_line: STRIPE_LEAK_LINE,
  },
];

// A pure type-annotation refactor — no secrets, no logic change. Deliberately
// touches a DIFFERENT file than the stripe-leak case so a fixture that always
// cites `src/config.ts` (shared across both cases in a batch, since the mock
// LLM returns the same structured output regardless of which case's diff was
// sent) gets dropped by citation-grounding for THIS case ("file not present
// in diff") rather than counted as noise here too.
export const CLEAN_REFACTOR_DIFF = [
  'diff --git a/src/utils/format.ts b/src/utils/format.ts',
  '--- a/src/utils/format.ts',
  '+++ b/src/utils/format.ts',
  '@@ -1,3 +1,3 @@',
  '-export function formatName(first, last) {',
  '-  return first + \' \' + last;',
  '+export function formatName(first: string, last: string): string {',
  '+  return first + \' \' + last;',
  ' }',
].join('\n');

export const CLEAN_REFACTOR_EXPECTED: unknown[] = [];

export interface SeedEvalsResult {
  agentId: string;
  caseIds: { stripeLeak: string; cleanRefactor: string };
}

/**
 * Attach the gold-set eval cases to the "Security Reviewer" agent seeded by
 * `seed()`. Throws if that agent doesn't exist yet — callers must run
 * `seed(db)` first (mirrors the main seed's own ordering requirements, e.g.
 * `pr_intent` before `pr_brief`).
 */
export async function seedEvals(db: Db, opts: { workspaceId: string }): Promise<SeedEvalsResult> {
  const { workspaceId } = opts;

  const [agent] = await db
    .select()
    .from(t.agents)
    .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.name, SECURITY_REVIEWER_NAME)));
  if (!agent) {
    throw new Error(
      `seedEvals: "${SECURITY_REVIEWER_NAME}" agent not found in workspace ${workspaceId} — run seed(db) first`,
    );
  }

  const evalsRepo = new EvalsRepository(db);
  const existing = await evalsRepo.listCasesForOwner(workspaceId, 'agent', agent.id);
  const byName = new Map(existing.map((c) => [c.name, c]));

  let stripeLeak = byName.get(STRIPE_LEAK_CASE_NAME);
  if (!stripeLeak) {
    stripeLeak = await evalsRepo.createCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: STRIPE_LEAK_CASE_NAME,
      inputDiff: STRIPE_LEAK_DIFF,
      expectedOutput: STRIPE_LEAK_EXPECTED,
      notes:
        'Accepted finding (must_find): a live Stripe secret key committed in plaintext in src/config.ts:12.',
    });
  }

  let cleanRefactor = byName.get(CLEAN_REFACTOR_CASE_NAME);
  if (!cleanRefactor) {
    cleanRefactor = await evalsRepo.createCase({
      workspaceId,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: CLEAN_REFACTOR_CASE_NAME,
      inputDiff: CLEAN_REFACTOR_DIFF,
      expectedOutput: CLEAN_REFACTOR_EXPECTED,
      notes: 'Dismissed finding (must_not_flag): a type-annotation-only refactor with no security concerns.',
    });
  }

  return {
    agentId: agent.id,
    caseIds: { stripeLeak: stripeLeak.id, cleanRefactor: cleanRefactor.id },
  };
}

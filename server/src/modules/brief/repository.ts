/**
 * repository.ts — persistence for the PR brief cache (`pr_brief` table).
 *
 * Onion layer: infrastructure. This is the only file in `modules/brief/` allowed to
 * import `db/schema` + `drizzle-orm` — everything else in the module reaches the DB
 * through this repository.
 *
 * `pr_brief.json` is an untyped `jsonb` column (no typed-column safety net like
 * `pr_intent` has), so `BriefEnvelope.safeParse` on every read is mandatory: a bad
 * shape or a stale `schema_version` must degrade to a cache miss (`undefined`),
 * never throw. Tenancy is enforced upstream by the workspace-scoped
 * `ReviewRepository.getPull(workspaceId, prId)`, exactly as `pr_intent` does — this
 * repository does not need a `workspace_id` check of its own (the table has none).
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import { BriefEnvelope } from '@devdigest/shared';
import { BRIEF_SCHEMA_VERSION } from './constants.js';

export class BriefRepository {
  constructor(private db: Db) {}

  /**
   * Returns the cached envelope, or `undefined` on a cache miss — which includes a
   * failed `safeParse` and a `schema_version` mismatch (AC-26). Never throws on a
   * malformed/stale row; callers should treat `undefined` as "recompute".
   */
  async getEnvelope(prId: string): Promise<BriefEnvelope | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    if (!row) return undefined;

    const parsed = BriefEnvelope.safeParse(row.json);
    if (!parsed.success) return undefined;
    if (parsed.data.schema_version !== BRIEF_SCHEMA_VERSION) return undefined;

    return parsed.data;
  }

  async upsertEnvelope(prId: string, env: BriefEnvelope): Promise<void> {
    await this.db
      .insert(t.prBrief)
      .values({ prId, json: env })
      .onConflictDoUpdate({ target: t.prBrief.prId, set: { json: env } });
  }
}

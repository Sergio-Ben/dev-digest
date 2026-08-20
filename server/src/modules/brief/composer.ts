/**
 * composer.ts — PR Brief composition (one structured LLM call).
 *
 * Pure application-layer helper: takes resolved inputs (PR metadata, diff,
 * intent, blast radius, linked issue, references) plus an injected
 * `LLMProvider`, assembles the header-only prompt via `prompt.ts`, and makes
 * exactly one `llm.completeStructured` call constrained to the `Brief`
 * schema. Mirrors `intent/classifier.ts`'s shape and its token-savings
 * logging discipline.
 *
 * Onion layer: application helper (pure — no DB, no GitHub, no fetching; all
 * inputs are injected/resolved by the caller, mirroring `intent/classifier.ts`).
 */
import type { BlastRadiusResult, Brief, Intent, LLMProvider, UnifiedDiff } from '@devdigest/shared';
import { Brief as BriefSchema } from '@devdigest/shared';
import type { z } from 'zod';
import { estimateTokens } from '../_shared/diff-prompt.js';
import type { Logger } from '../reviews/run-executor.js';
import { buildUserMessage, SYSTEM_PROMPT, type BriefReference } from './prompt.js';

export interface ComposeBriefOpts {
  title: string;
  author: string;
  branch: string;
  base: string;
  body: string | null;
  diffStats: { additions: number; deletions: number; changedFileCount: number };
  diff: UnifiedDiff;
  intent?: Intent | null;
  blast?: BlastRadiusResult | null;
  issue?: { title: string; body: string | null } | null;
  references?: BriefReference[];
  llm: LLMProvider;
  model: string;
  provider: string;
  logger?: Logger;
}

export interface ComposeBriefResult {
  raw: Brief;
  sections: { present: string[]; absent: string[] };
  tokens: { headerOnly: number; fullDiff: number; saved: number };
}

/**
 * Compose a `Brief` from resolved PR signals with exactly one structured LLM
 * call (AC-10). Logs which prompt sections were present/absent plus the
 * resolved provider/model (AC-43), and both the header-only and full-diff
 * token estimates — using the same coarse estimator the intent classifier
 * uses — so AC-45's cost claim is comparable across the two paths.
 */
export async function composeBrief(opts: ComposeBriefOpts): Promise<ComposeBriefResult> {
  const {
    title,
    author,
    branch,
    base,
    body,
    diffStats,
    diff,
    intent = null,
    blast = null,
    issue = null,
    references = [],
    llm,
    model,
    provider,
    logger,
  } = opts;

  const { message, sections } = buildUserMessage({
    title,
    author,
    branch,
    base,
    body,
    diffStats,
    diff,
    intent,
    blast,
    issue,
    references,
  });

  // Token-savings metrics (heuristic: chars / 4, same method as the intent
  // classifier — AC-45 must use "the same estimation method").
  const fullDiffTokens = estimateTokens(diff.raw);
  const headerOnlyTokens = estimateTokens(message);
  const savedTokens = fullDiffTokens - headerOnlyTokens;

  logger?.info(
    { provider, model, sections },
    'brief: assembled prompt sections',
  );

  const result = await llm.completeStructured<Brief>({
    model,
    // `BriefRisk.endpoint_refs` uses `.default([])`, so the schema's INPUT
    // type has that field optional while its OUTPUT type (== `Brief`, the
    // one this module cares about) requires it. `z.ZodType<T>`'s Input
    // parameter defaults to `T` too, which trips a spurious assignability
    // error even though the two Output types are identical — cast away the
    // Input-side mismatch; the runtime schema and its validation are
    // unaffected.
    schema: BriefSchema as unknown as z.ZodType<Brief>,
    schemaName: 'Brief',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: message },
    ],
    temperature: 0.1,
  });

  // Log both token estimates (AC-45) plus the structured call's own
  // tokens/cost — `StructuredResult` carries `tokensIn`/`tokensOut`/
  // `costUsd`; unlike the intent classifier (which discards them), we log
  // them here since AC-45 is a cost claim.
  logger?.info(
    {
      provider,
      model,
      fullDiffTokens,
      headerOnlyTokens,
      savedTokens,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
    },
    `brief: header-only input saved ~${savedTokens} tokens vs full diff`,
  );

  return {
    raw: result.data,
    sections,
    tokens: { headerOnly: headerOnlyTokens, fullDiff: fullDiffTokens, saved: savedTokens },
  };
}

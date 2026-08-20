/**
 * state-key.ts — pure hashing helpers for brief cache validity.
 *
 * Onion layer: application (pure). No DB, no HTTP, no LLM calls — every
 * export here is a deterministic function of its inputs.
 *
 * Two hashes are produced, deliberately kept separate:
 *  - `deriveStateKey` is the CACHE VALIDITY KEY. It intentionally excludes
 *    blast-radius facts entirely (see Known gotchas below) so recomposing a
 *    brief for the same head/paths/intent/provider/model is a cache hit even
 *    though blast radius output (LLM `summary`, `priorPrs`) is non-deterministic.
 *  - `fingerprintBlast` is a DIAGNOSTIC-ONLY fingerprint over blast radius'
 *    deterministic facts, used to explain/inspect drift — it is never an
 *    input to `deriveStateKey`.
 */
import { createHash } from 'node:crypto';
import type { BlastRadiusResult, Intent } from '@devdigest/shared';
import { BRIEF_SCHEMA_VERSION } from './constants.js';

/**
 * Recursively sorts object keys (alphabetically) so that two objects with
 * the same keys/values but different insertion order produce identical
 * JSON. Arrays are preserved in their given order — callers that need
 * order-independence must sort array contents themselves before calling.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }
  if (value !== null && typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Stable sha256 over ONLY the deterministic facts of a blast radius result:
 * `changedSymbols`, `callers`, `impactedEndpoints`, `factsByFile`, `degraded`,
 * `reason`. `summary` (LLM output) and `priorPrs` (changes whenever unrelated
 * PRs land) are excluded on purpose — see module doc comment. Diagnostic use
 * only; NOT an input to `deriveStateKey`.
 */
export function fingerprintBlast(blast: BlastRadiusResult): string {
  const changedSymbols = [...blast.changedSymbols].sort((a, b) =>
    compareStrings(`${a.file}|${a.name}|${a.kind}`, `${b.file}|${b.name}|${b.kind}`),
  );

  const callers = [...blast.callers].sort((a, b) =>
    compareStrings(
      `${a.file}|${a.symbol}|${a.viaSymbol}|${a.line}|${a.rank}`,
      `${b.file}|${b.symbol}|${b.viaSymbol}|${b.line}|${b.rank}`,
    ),
  );

  const impactedEndpoints = [...blast.impactedEndpoints].sort(compareStrings);

  const factsByFile = blast.factsByFile
    ? Object.fromEntries(
        Object.entries(blast.factsByFile)
          .sort(([a], [b]) => compareStrings(a, b))
          .map(([file, facts]) => [
            file,
            {
              endpoints: [...facts.endpoints].sort(compareStrings),
              crons: [...facts.crons].sort(compareStrings),
            },
          ]),
      )
    : undefined;

  const deterministic = {
    changedSymbols,
    callers,
    impactedEndpoints,
    factsByFile,
    degraded: blast.degraded ?? false,
    reason: blast.reason ?? null,
  };

  return sha256(JSON.stringify(canonicalize(deterministic)));
}

/**
 * Cache validity key. Hash over
 * `BRIEF_SCHEMA_VERSION | headSha | sorted(changedPaths) | canonical(intent) | provider | model`.
 * Blast radius facts are deliberately NOT part of this input (see module doc
 * comment) — recomposing for the same head/paths/intent/provider/model must
 * be a cache hit regardless of blast radius's non-deterministic fields.
 */
export function deriveStateKey(input: {
  headSha: string | null;
  changedPaths: string[];
  intent: Intent | null;
  provider: string;
  model: string;
}): string {
  const sortedChangedPaths = [...input.changedPaths].sort(compareStrings);
  const canonicalIntent = input.intent ? canonicalize(input.intent) : null;

  const parts = [
    String(BRIEF_SCHEMA_VERSION),
    input.headSha ?? '',
    JSON.stringify(sortedChangedPaths),
    JSON.stringify(canonicalIntent),
    input.provider,
    input.model,
  ];

  return sha256(parts.join('|'));
}

/**
 * AC-9: citable sets used to ground brief output — files from the changed
 * paths, endpoints from `blast.impactedEndpoints` plus the union of every
 * file's `crons` in `blast.factsByFile` (crons live ONLY there — there is no
 * separate `affectedCrons` field).
 */
export function citableSets(
  changedPaths: string[],
  blast: BlastRadiusResult | null,
): { files: Set<string>; endpoints: Set<string> } {
  const files = new Set(changedPaths);
  const endpoints = new Set<string>(blast?.impactedEndpoints ?? []);

  if (blast?.factsByFile) {
    for (const facts of Object.values(blast.factsByFile)) {
      for (const cron of facts.crons) {
        endpoints.add(cron);
      }
    }
  }

  return { files, endpoints };
}

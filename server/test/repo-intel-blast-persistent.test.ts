import { describe, it, expect } from 'vitest';
import { RepoIntelService } from '../src/modules/repo-intel/service.js';
import { MAX_CALLERS_PER_SYMBOL } from '../src/modules/repo-intel/constants.js';
import type { FullSymbolRow } from '../src/modules/repo-intel/repository.js';

/**
 * Persistent blast path (`tryPersistentBlast`) — the branch that serves
 * `getBlastRadius` straight from Postgres, with no clone parsing.
 *
 * Covers the two invariants that are easy to get wrong and invisible in a
 * happy-path fixture: the caller cap is PER CHANGED SYMBOL (a global slice
 * starves every symbol but the highest-ranked one), and a `partial` index is
 * reported as such instead of masquerading as a complete answer.
 *
 * No Postgres: the service's `repo` is patched with the four methods the
 * persistent path reads.
 */

const CHANGED = ['src/limiter.ts'];

/** Two changed symbols, each with more callers than the per-symbol cap. */
const DECL_ROWS: FullSymbolRow[] = ['rateLimit', 'bucketKey'].map((name) => ({
  path: 'src/limiter.ts',
  name,
  kind: 'function',
  line: 1,
  endLine: 10,
  exported: true,
  signature: null,
}));

/**
 * `rateLimit` gets the top ranks so a global slice would consume the whole
 * budget on it and leave `bucketKey` with nothing.
 */
const CALLER_ROWS = [
  ...Array.from({ length: 30 }, (_, i) => ({
    fromPath: `src/high/${i}.ts`,
    toSymbol: 'rateLimit',
    line: i + 1,
    rank: 1000 - i,
  })),
  ...Array.from({ length: 30 }, (_, i) => ({
    fromPath: `src/low/${i}.ts`,
    toSymbol: 'bucketKey',
    line: i + 1,
    rank: 100 - i,
  })),
];

function buildService(
  status: 'full' | 'partial' | 'failed' | null,
  opts: { repoIntelEnabled?: boolean } = {},
) {
  const container = {
    config: { repoIntelEnabled: opts.repoIntelEnabled ?? true },
    db: {} as never,
    codeIndex: { symbols: async () => [], references: async () => [] } as never,
  } as never;

  const svc = new RepoIntelService(container);
  (svc as unknown as { repo: Record<string, unknown> }).repo = {
    tryGetIndexState: async () =>
      status === null ? null : { status, lastIndexedSha: 'abc' },
    // Only reached on the ripgrep fallback; no clone → the degraded literal.
    getRepoBasics: async () => null,
    // Called twice: once for the changed files (declarations), once for the
    // caller files (to name the enclosing symbol). Only the former has rows.
    getSymbolRows: async (_repoId: string, paths: string[]) =>
      paths.length === 1 && paths[0] === CHANGED[0] ? DECL_ROWS : [],
    getResolvedCallers: async () => CALLER_ROWS,
    getFileFacts: async (_repoId: string, files: string[]) =>
      files.map((filePath) => ({
        filePath,
        endpoints: [`GET /${filePath}`],
        crons: [],
      })),
  };
  return svc;
}

describe('RepoIntel.getBlastRadius — persistent path', () => {
  it('caps callers per changed symbol, not across the whole result', async () => {
    const svc = buildService('full');
    const blast = await svc.getBlastRadius('r1', CHANGED);

    const bySymbol = new Map<string, number>();
    for (const c of blast.callers) {
      bySymbol.set(c.viaSymbol, (bySymbol.get(c.viaSymbol) ?? 0) + 1);
    }

    // Each symbol gets its own budget — the lower-ranked one is not starved.
    expect(bySymbol.get('rateLimit')).toBe(MAX_CALLERS_PER_SYMBOL);
    expect(bySymbol.get('bucketKey')).toBe(MAX_CALLERS_PER_SYMBOL);
    expect(blast.callers).toHaveLength(MAX_CALLERS_PER_SYMBOL * 2);

    // Within a symbol the retained callers are the highest-ranked ones.
    const high = blast.callers.filter((c) => c.viaSymbol === 'rateLimit');
    expect(Math.min(...high.map((c) => c.rank))).toBe(1000 - (MAX_CALLERS_PER_SYMBOL - 1));
  });

  it('reports only endpoints reachable through a retained caller', async () => {
    const svc = buildService('full');
    const blast = await svc.getBlastRadius('r1', CHANGED);

    // getFileFacts is keyed off the RETAINED caller files, so a dropped caller
    // can never contribute a phantom endpoint.
    const retainedFiles = new Set(blast.callers.map((c) => c.file));
    expect(Object.keys(blast.factsByFile ?? {}).sort()).toEqual(
      [...retainedFiles].sort(),
    );
    expect(blast.impactedEndpoints).toHaveLength(retainedFiles.size);
    expect(blast.impactedEndpoints).not.toContain('GET /src/high/25.ts');
  });

  it('marks the result index_partial when the index is only partial', async () => {
    const svc = buildService('partial');
    const blast = await svc.getBlastRadius('r1', CHANGED);

    // Real data, but explicitly flagged as incomplete rather than passed off
    // as a full answer.
    expect(blast.changedSymbols).toHaveLength(2);
    expect(blast.callers.length).toBeGreaterThan(0);
    expect(blast.degraded).toBe(true);
    expect(blast.reason).toBe('index_partial');
  });

  it('does not flag a full index as degraded', async () => {
    const svc = buildService('full');
    const blast = await svc.getBlastRadius('r1', CHANGED);
    expect(blast.degraded).toBe(false);
    expect(blast.reason).toBeUndefined();
  });

  /**
   * The degraded REASON is the actionable half of the contract: "re-index",
   * "flip the flag" and "there is genuinely nothing here" are three different
   * instructions, and collapsing them all into `no_data` hides two of them.
   */
  it('reports index_failed when the index row exists but is not queryable', async () => {
    const svc = buildService('failed');
    const blast = await svc.getBlastRadius('r1', CHANGED);
    expect(blast.degraded).toBe(true);
    expect(blast.reason).toBe('index_failed');
  });

  it('reports flag_off when repo-intel is disabled', async () => {
    const svc = buildService('full', { repoIntelEnabled: false });
    const blast = await svc.getBlastRadius('r1', CHANGED);
    expect(blast.degraded).toBe(true);
    expect(blast.reason).toBe('flag_off');
  });

  it('reports no_data when the repo was never indexed', async () => {
    const svc = buildService(null);
    const blast = await svc.getBlastRadius('r1', CHANGED);
    expect(blast.degraded).toBe(true);
    expect(blast.reason).toBe('no_data');
  });
});

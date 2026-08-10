import type { BlastRadiusResult, BlastCallerRow } from "@devdigest/shared";

/** The two ways to read the same impact map: indented tree, or force graph. */
export const BLAST_VIEWS = ["tree", "graph"] as const;
export type BlastView = (typeof BLAST_VIEWS)[number];

/** Collect all unique cron strings from factsByFile. */
export function buildCronSet(
  factsByFile: BlastRadiusResult["factsByFile"],
): Set<string> {
  const set = new Set<string>();
  if (!factsByFile) return set;
  for (const facts of Object.values(factsByFile)) {
    for (const cron of facts.crons) set.add(cron);
  }
  return set;
}

export interface SymbolRow {
  file: string;
  name: string;
  kind: string;
  callers: BlastCallerRow[];
  endpoints: string[];
  crons: string[];
}

export function distinctSymbolNames(data: BlastRadiusResult): number {
  return new Set(data.changedSymbols.map((s) => s.name)).size;
}


export function buildSymbolRows(data: BlastRadiusResult): SymbolRow[] {
  const byName = new Map<string, BlastRadiusResult["changedSymbols"][number]>();
  for (const sym of data.changedSymbols) {
    if (!byName.has(sym.name)) byName.set(sym.name, sym);
  }

  return [...byName.values()]
    .map((sym) => {
      const callers = data.callers.filter((c) => c.viaSymbol === sym.name);
      const callerFiles = new Set(callers.map((c) => c.file));
      const endpoints: string[] = [];
      const crons: string[] = [];

      if (data.factsByFile) {
        for (const [file, facts] of Object.entries(data.factsByFile)) {
          if (callerFiles.has(file)) {
            endpoints.push(...facts.endpoints);
            crons.push(...facts.crons);
          }
        }
      } else {
        endpoints.push(...data.impactedEndpoints);
      }

      return {
        file: sym.file,
        name: sym.name,
        kind: sym.kind,
        callers,
        endpoints: [...new Set(endpoints)],
        crons: [...new Set(crons)],
      };
    })
    .filter((row) => row.callers.length > 0);
}

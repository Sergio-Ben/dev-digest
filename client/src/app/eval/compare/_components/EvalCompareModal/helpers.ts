/* helpers.ts — pure formatting for the compare view (module-level, unit
   testable, no React deps). Deltas always carry a sign glyph (▲/▼/–), never
   colour alone, per the a11y gotcha on this task.

   Values are returned in PARTS (old/new/delta), not one flat string — the
   approved "Compare runs · v6 → v7" design renders the new value large/bold
   and colour-accented, with the old value and the delta chip styled
   differently. `DeltaCard` composes the parts back into the exact same
   concatenated text the old flat-string version produced (see its render),
   so no visible copy changed. */
import type { EvalBatchRow } from "@devdigest/shared";
import { formatCost } from "@/lib/cost";

export type DeltaSign = "up" | "down" | "flat";

export interface DeltaParts {
  oldText: string;
  newText: string;
  deltaText: string;
  sign: DeltaSign;
}

export function deltaSign(delta: number): DeltaSign {
  if (delta > 0) return "up";
  if (delta < 0) return "down";
  return "flat";
}

const SIGN_GLYPH: Record<DeltaSign, string> = {
  up: "▲",
  down: "▼",
  flat: "–",
};

/** Round a 0..1 fraction to a whole percent point. */
function pct(fraction: number): number {
  return Math.round(fraction * 100);
}

/**
 * Parts for a "78% → 82% ▲4pt" style delta on a fraction metric (recall,
 * precision, citation_accuracy). `delta` is the raw fraction delta from the
 * compare response (newer - older), already computed server-side.
 */
export function formatPercentParts(older: number, newer: number, delta: number): DeltaParts {
  const deltaPts = Math.round(delta * 100);
  const sign = deltaSign(deltaPts);
  return {
    oldText: `${pct(older)}%`,
    newText: `${pct(newer)}%`,
    deltaText: `${SIGN_GLYPH[sign]}${Math.abs(deltaPts)}pt`,
    sign,
  };
}

/** Cost delta isn't in `EvalCompareResult.deltas` — derive it client-side
 *  from the two batch rows' `cost_usd`. Returns `null` when either side is
 *  missing cost data (un-priced / historical run). */
export function costDelta(older: EvalBatchRow, newer: EvalBatchRow): number | null {
  if (older.cost_usd == null || newer.cost_usd == null) return null;
  return newer.cost_usd - older.cost_usd;
}

/** Strip the leading currency symbol from `formatCost`'s output — the
 *  approved design shows bare numbers ("0.21 → 0.23 ▲0.02"), not "$0.21".
 *  Still reuses `formatCost`'s decimal-trimming rules rather than
 *  re-deriving money formatting locally. */
function bareCost(usd: number | null | undefined): string {
  return formatCost(usd).replace(/^\$/, "");
}

/** Parts for a "0.21 → 0.23 ▲0.02" style delta on the cost metric. */
export function formatCostParts(
  older: number | null,
  newer: number | null,
  delta: number | null,
): DeltaParts {
  const sign = delta != null ? deltaSign(delta) : "flat";
  return {
    oldText: bareCost(older),
    newText: bareCost(newer),
    deltaText: delta == null ? "" : `${SIGN_GLYPH[sign]}${bareCost(Math.abs(delta))}`,
    sign,
  };
}

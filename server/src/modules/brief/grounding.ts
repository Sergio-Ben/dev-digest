/**
 * grounding.ts — pure grounding gate for a generated `Brief`.
 *
 * Onion layer: application logic, pure (no DB, no HTTP, no LLM calls, no
 * `Date`, no randomness). Mirrors the "discard, never repair" philosophy of
 * `reviewer-core/src/grounding.ts` and its score recomputation: a risk or
 * review-focus entry that cites something not present in the diff/blast
 * facts is DROPPED wholesale, never patched or partially kept.
 */

import { BRIEF_RISK_LEVEL_ORDER, parseFileRef } from '@devdigest/shared';
import type { Brief, BriefRisk, ReviewFocusItem } from '@devdigest/shared';
import { MAX_REVIEW_FOCUS } from './constants.js';

export interface GroundingSets {
  /** File paths that are actually part of the diff/blast radius. */
  files: ReadonlySet<string>;
  /** Endpoint identifiers actually present in the blast radius. */
  endpoints: ReadonlySet<string>;
}

export interface GroundingStats {
  risksIn: number;
  risksOut: number;
  focusIn: number;
  focusOut: number;
}

export interface GroundingOutcome {
  brief: Brief;
  stats: GroundingStats;
}

/**
 * Grounds a raw (model-produced) `Brief` against the sets of file paths and
 * endpoints that are actually known to be real (diff files ∪ blast-radius
 * files, and blast-radius endpoints). Does not mutate `raw` — returns a new
 * `Brief`.
 */
export function groundBrief(raw: Brief, sets: GroundingSets): GroundingOutcome {
  const risksIn = raw.risks.length;
  const focusIn = raw.review_focus.length;

  // 1-3: ground each risk's file_refs and endpoint_refs, drop risks with no
  // surviving file_refs (AC-15..AC-17, AC-19).
  const groundedRisks: BriefRisk[] = [];
  for (const risk of raw.risks) {
    const groundedFileRefs = risk.file_refs.filter((ref) => sets.files.has(parseFileRef(ref).file));
    if (groundedFileRefs.length === 0) continue;

    const groundedEndpointRefs = risk.endpoint_refs.filter((ep) => sets.endpoints.has(ep));

    groundedRisks.push({
      ...risk,
      file_refs: groundedFileRefs,
      endpoint_refs: groundedEndpointRefs,
    });
  }

  // 4: drop review_focus entries whose file isn't real, or whose
  // endpoint_ref (when present) isn't real (AC-18, AC-19).
  const survivingFocus = raw.review_focus.filter((item) => {
    if (!sets.files.has(item.file)) return false;
    if (item.endpoint_ref != null && !sets.endpoints.has(item.endpoint_ref)) return false;
    return true;
  });

  // 5: dedupe by `${file}:${line ?? ''}`, first occurrence wins.
  const seen = new Set<string>();
  const dedupedFocus: ReviewFocusItem[] = [];
  for (const item of survivingFocus) {
    const key = `${item.file}:${item.line ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    dedupedFocus.push(item);
  }

  // 6: truncate to MAX_REVIEW_FOCUS, preserving model order, dropping (never
  // merging) the remainder.
  const truncatedFocus = dedupedFocus.slice(0, MAX_REVIEW_FOCUS);

  // 7: risk_level = highest surviving severity if lower than the model's
  // value; 'low' + risks: [] when nothing survives.
  let riskLevel: Brief['risk_level'];
  let finalRisks: BriefRisk[];
  if (groundedRisks.length === 0) {
    riskLevel = 'low';
    finalRisks = [];
  } else {
    finalRisks = groundedRisks;
    const modelIdx = BRIEF_RISK_LEVEL_ORDER.indexOf(raw.risk_level);
    let highestIdx = -1;
    for (const risk of groundedRisks) {
      const idx = BRIEF_RISK_LEVEL_ORDER.indexOf(risk.severity);
      if (idx > highestIdx) highestIdx = idx;
    }
    riskLevel = highestIdx >= 0 && highestIdx < modelIdx ? BRIEF_RISK_LEVEL_ORDER[highestIdx]! : raw.risk_level;
  }

  const groundedBrief: Brief = {
    ...raw,
    risk_level: riskLevel,
    risks: finalRisks,
    review_focus: truncatedFocus,
  };

  return {
    brief: groundedBrief,
    stats: {
      risksIn,
      risksOut: finalRisks.length,
      focusIn,
      focusOut: truncatedFocus.length,
    },
  };
}

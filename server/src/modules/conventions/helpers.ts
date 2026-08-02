import type {
  ConventionCandidate,
  ConventionScan,
  ConventionStatus,
} from '@devdigest/shared';
import type { ConventionRow, ConventionScanRow } from '../../db/rows.js';

/** Pure row ⇄ DTO mapping for the conventions module. No I/O. */

export function toCandidateDto(row: ConventionRow): ConventionCandidate {
  return {
    id: row.id,
    category: row.category,
    rule: row.rule,
    // The columns are nullable for historical reasons; a candidate that reached
    // the DB always has verified evidence, so an empty string is unreachable.
    evidencePath: row.evidencePath ?? '',
    evidenceSnippet: row.evidenceSnippet ?? '',
    evidenceStartLine: row.evidenceStartLine,
    evidenceEndLine: row.evidenceEndLine,
    confidence: row.confidence ?? 0,
    status: row.status as ConventionStatus,
    skillId: row.skillId,
  };
}

export function toScanDto(row: ConventionScanRow): ConventionScan {
  return {
    id: row.id,
    sample_count: row.sampleCount,
    candidate_count: row.candidateCount,
    dropped_count: row.droppedCount,
    model: row.model,
    created_at: row.createdAt.toISOString(),
  };
}

/** Rules are compared case/whitespace-insensitively for re-scan dedupe. */
export function normaliseRule(rule: string): string {
  return rule.toLowerCase().replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

/** Model-supplied categories are free text; store them lower-kebab. */
export function normaliseCategory(category: string | null | undefined): string | null {
  if (!category) return null;
  const out = category
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return out || null;
}

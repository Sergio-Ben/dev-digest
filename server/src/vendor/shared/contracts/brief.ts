import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- PR History ----
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

/**
 * One finding anchored to a line of this file. Carries the finding's ID so the
 * Smart Diff can deep-link to that finding's CARD in the Agent-runs tab
 * (in-app routing) — `finding_lines` alone only says "something is flagged
 * here", which is not enough to identify which finding was clicked.
 */
export const SmartDiffFinding = z.object({
  id: z.string(),
  line: z.number().int(),
});
export type SmartDiffFinding = z.infer<typeof SmartDiffFinding>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  /** Anchor lines only — kept for line highlighting and the badge's count. */
  finding_lines: z.array(z.number().int()),
  /** Same findings as `finding_lines`, same order, but identifiable. */
  findings: z.array(SmartDiffFinding).default([]),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) — Part-0 placeholder ----
// Superseded by `BriefEnvelope` (below) as the actual `pr_brief.json` shape.
// Kept only because `PrBrief`'s member types (Intent, BlastRadius, Risks,
// PrHistory) are still used independently elsewhere.
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ---- PR Brief feature (pr_brief.json) ----
// `BriefRiskLevel` re-exports `RiskSeverity` so the brief's `risk_level` and
// each risk's `severity` share one ordered domain (AC-20 compares over it).
export const BriefRiskLevel = RiskSeverity;
export type BriefRiskLevel = RiskSeverity;
export const BRIEF_RISK_LEVEL_ORDER = ['low', 'medium', 'high'] as const;

export const ReviewFocusItem = z.object({
  file: z.string().min(1),
  line: z.number().int().positive().nullable(),
  reason: z.string().min(1),
  endpoint_ref: z.string().nullish(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

// `Risk` itself is not modified (kept as-is for existing `Risks` consumers) —
// `BriefRisk` extends it with the file/endpoint reference requirements the
// brief's grounding pass needs (G-a/G-b).
export const BriefRisk = Risk.extend({
  file_refs: z.array(z.string()).min(1),
  endpoint_refs: z.array(z.string()).default([]),
});
export type BriefRisk = z.infer<typeof BriefRisk>;

export const Brief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: BriefRiskLevel,
  risks: z.array(BriefRisk),
  review_focus: z.array(ReviewFocusItem),
});
export type Brief = z.infer<typeof Brief>;

// AC-45's header-only vs full-diff token estimate (already computed by
// composeBrief/composer.ts for its cost-savings log line) — surfaced to the
// client so the PR Brief card can show the same cost-visibility promise
// (US-6) the log line makes server-side. Persisted in the envelope so a
// cache-hit read still has a number to show, not just a fresh compose.
export const BriefTokens = z.object({
  header_only: z.number().int(),
  full_diff: z.number().int(),
});
export type BriefTokens = z.infer<typeof BriefTokens>;

export const BriefEnvelope = z.object({
  schema_version: z.number().int(),
  state_key: z.string(),
  head_sha: z.string().nullable(),
  generated_at: z.string(),
  provider: z.string(),
  model: z.string(),
  degraded_inputs: z.array(z.string()),
  blast_fingerprint: z.string().nullable(),
  tokens: BriefTokens.nullable(),
  brief: Brief,
});
export type BriefEnvelope = z.infer<typeof BriefEnvelope>;

// ---- Brief HTTP response (GET/POST /pulls/:id/brief) ----
export const BriefResponse = z.object({
  brief: Brief,
  degraded_inputs: z.array(z.string()),
  head_sha: z.string().nullable(),
  generated_at: z.string(),
  provider: z.string(),
  model: z.string(),
  tokens: BriefTokens.nullable(),
});
export type BriefResponse = z.infer<typeof BriefResponse>;

/**
 * Splits a file reference like `src/config.ts:12` into its file path and
 * optional 1-based line number. Pure — no I/O. Single definition shared by
 * the server's grounding pass and the client's risk-row rendering so the
 * two cannot drift.
 */
export function parseFileRef(ref: string): { file: string; line: number | null } {
  const match = ref.match(/^(.*):(\d+)$/);
  if (!match) return { file: ref, line: null };
  const [, file, lineStr] = match;
  return { file: file ?? ref, line: lineStr ? Number(lineStr) : null };
}

// ---- Blast Radius HTTP response (GET /pulls/:id/blast) ----
// Note: two parallel type families exist intentionally:
//   repo-intel/types.ts: BlastResult, BlastChangedSymbol, BlastCallerRow — INTERNAL, server only
//   brief.ts (below):    BlastRadiusResult + prefixed types — HTTP CONTRACT, client + MCP
// BlastService maps internal → contract before returning.
export const BlastDegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);
export type BlastDegradedReason = z.infer<typeof BlastDegradedReason>;

export const BlastChangedSymbol = z.object({
  file: z.string(),
  name: z.string(),
  kind: z.string(),
});
export type BlastChangedSymbol = z.infer<typeof BlastChangedSymbol>;

export const BlastCallerRow = z.object({
  file: z.string(),
  symbol: z.string(),
  viaSymbol: z.string(),
  line: z.number().int(),
  rank: z.number().int(),
});
export type BlastCallerRow = z.infer<typeof BlastCallerRow>;

export const PriorPr = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  openedAt: z.string().nullable(),
  status: z.string(),
});
export type PriorPr = z.infer<typeof PriorPr>;

export const BlastRadiusResult = z.object({
  changedSymbols: z.array(BlastChangedSymbol),
  callers: z.array(BlastCallerRow),
  impactedEndpoints: z.array(z.string()),
  factsByFile: z
    .record(
      z.object({
        endpoints: z.array(z.string()),
        crons: z.array(z.string()),
      }),
    )
    .optional(),
  degraded: z.boolean().optional(),
  reason: BlastDegradedReason.optional(),
  priorPrs: z.array(PriorPr).optional(),
  summary: z.string().optional(),
});
export type BlastRadiusResult = z.infer<typeof BlastRadiusResult>;

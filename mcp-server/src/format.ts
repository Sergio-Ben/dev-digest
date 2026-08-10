/**
 * Shared response-shaping helpers.
 *
 * Centralises:
 *  - toolOk / toolError — MCP tool result envelope construction
 *  - compact* shapers — concise projections that drop UUIDs, full text fields,
 *    and verbose diagnostics to keep responses token-efficient
 *
 * All functions are pure (no I/O, no side effects).
 *
 * NOTE: Finding uses start_line / end_line (not "line"). compactFinding surfaces
 * start_line as "line" so callers get a clean file:line signal.
 */

import type {
  Finding,
  Agent,
  ConventionCandidate,
  BlastRadiusResult,
} from '@devdigest/shared';

// ---------------------------------------------------------------------------
// MCP tool result envelope
// ---------------------------------------------------------------------------

export type ToolContent = { type: 'text'; text: string };
export type ToolResult = { content: ToolContent[]; isError?: true };

/** Wrap a successful data payload as an MCP tool result. */
export function toolOk(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  };
}

/** Wrap an error message as an MCP tool result with isError: true. */
export function toolError(message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Compact shapers — concise projections for tool responses
// ---------------------------------------------------------------------------

/**
 * Compact finding — drops UUIDs, confidence, suggestion, kind, trifecta fields.
 * Surfaces start_line as `line` for human-readable file:line signals.
 */
export type CompactFinding = {
  severity: Finding['severity'];
  title: string;
  file: string;
  line: number;
  rationale: string;
};

export function compactFinding(f: Finding): CompactFinding {
  return {
    severity: f.severity,
    title: f.title,
    file: f.file,
    line: f.start_line,
    rationale: f.rationale,
  };
}

/**
 * Compact agent — returns only the fields relevant to tool callers:
 * id, name, enabled, model. Drops system_prompt, description, version, etc.
 */
export type CompactAgent = {
  id: string;
  name: string;
  enabled: boolean;
  model: string;
};

export function compactAgent(a: Agent): CompactAgent {
  return {
    id: a.id,
    name: a.name,
    enabled: a.enabled,
    model: a.model,
  };
}

/**
 * Compact convention — returns rule, evidence_path as file, confidence, accepted.
 * Drops evidence_snippet to keep responses token-efficient.
 */
export type CompactConvention = {
  rule: string;
  file: string;
  confidence: number;
  accepted: boolean;
};

export function compactConvention(c: ConventionCandidate): CompactConvention {
  return {
    rule: c.rule,
    file: c.evidence_path,
    confidence: c.confidence,
    accepted: c.accepted,
  };
}

/**
 * Compact blast radius — the wire shape is a flat symbol list plus a flat
 * caller list plus a per-file facts map, which a reader has to re-join itself.
 * This nests callers under the symbol they reach (the question actually being
 * asked: "who does this change affect?"), renders each caller as `file:line`,
 * and drops the pagerank floats and the `factsByFile` map, whose endpoints are
 * already summarised in `impactedEndpoints`.
 *
 * `degraded` / `reason` are preserved verbatim — an incomplete index is a fact
 * the caller has to see, not something to smooth over.
 */
export type CompactBlastSymbol = {
  symbol: string;
  file: string;
  kind: string;
  callers: string[];
};

export type CompactBlastRadius = {
  changedSymbols: CompactBlastSymbol[];
  impactedEndpoints: string[];
  priorPrs?: Array<{ number: number; title: string; status: string }>;
  degraded?: boolean;
  reason?: BlastRadiusResult['reason'];
  summary?: string;
};

export function compactBlastRadius(b: BlastRadiusResult): CompactBlastRadius {
  const out: CompactBlastRadius = {
    changedSymbols: b.changedSymbols.map((s) => ({
      symbol: s.name,
      file: s.file,
      kind: s.kind,
      callers: b.callers
        .filter((c) => c.viaSymbol === s.name)
        .map((c) => `${c.file}:${c.line}`),
    })),
    impactedEndpoints: b.impactedEndpoints,
  };
  if (b.priorPrs?.length) {
    out.priorPrs = b.priorPrs.map((p) => ({
      number: p.number,
      title: p.title,
      status: p.status,
    }));
  }
  if (b.degraded !== undefined) out.degraded = b.degraded;
  if (b.reason !== undefined) out.reason = b.reason;
  if (b.summary !== undefined) out.summary = b.summary;
  return out;
}

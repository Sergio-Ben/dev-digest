import type { BlastRadiusResult } from "@devdigest/shared";

/**
 * Layout model for the blast-radius diagram — pure, no React, no DOM.
 *
 * The diagram is a THREE-COLUMN flow, left to right:
 *
 *     changed symbol  →  caller  →  endpoint affected
 *
 * The columns themselves carry the direction, which is why no edge here has an
 * arrowhead: a reader can't mistake "impact flows rightwards" for "the changed
 * symbol imports its callers". Positions are deterministic (no force
 * simulation), so the same PR renders identically on every mount.
 */

export type BlastNodeKind = "symbol" | "caller" | "endpoint";

export interface BlastNode {
  id: string;
  kind: BlastNodeKind;
  /** Text as drawn — already truncated to the box. */
  label: string;
  /** Full, untruncated text for the tooltip and the accessible name. */
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BlastEdge {
  id: string;
  /** SVG cubic-bezier `d`, source right edge → target left edge. */
  path: string;
}

export interface BlastGraphModel {
  nodes: BlastNode[];
  edges: BlastEdge[];
  /** Intrinsic content size; the renderer scales this to fit its box. */
  width: number;
  height: number;
  /** Nodes the per-column caps dropped. Rendered as a footnote — a truncated
   *  column that says nothing reads as "this is everything", which is a lie. */
  overflow: { callers: number; endpoints: number };
}

// ── Layout constants ──────────────────────────────────────────────────────────

const NODE_HEIGHT = 34;
const ROW_GAP = 18;
const COLUMN_GAP = 64;
const PADDING = 14;
/** Advance width of one char at FONT_SIZE in the monospace stack below. */
const CHAR_WIDTH = 7.3;
const LABEL_PAD_X = 14;
const MIN_NODE_WIDTH = 88;
const OVERFLOW_ROW_HEIGHT = 18;

const MAX_LABEL_CHARS: Record<BlastNodeKind, number> = {
  symbol: 22,
  caller: 22,
  endpoint: 20,
};

/** Per-column caps. Past these the diagram stops being readable long before it
 *  stops being drawable, so trim and say how much was trimmed. */
const MAX_NODES: Record<BlastNodeKind, number> = {
  symbol: 8,
  caller: 10,
  endpoint: 8,
};

export const FONT_SIZE = 12;
export const FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function nodeWidth(label: string): number {
  return Math.max(MIN_NODE_WIDTH, label.length * CHAR_WIDTH + LABEL_PAD_X * 2);
}

function makeNode(
  id: string,
  kind: BlastNodeKind,
  title: string,
): Omit<BlastNode, "x" | "y"> {
  const label = truncate(title, MAX_LABEL_CHARS[kind]);
  return { id, kind, label, title, width: nodeWidth(label), height: NODE_HEIGHT };
}

function bezier(from: BlastNode, to: BlastNode): string {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  // Horizontal control-point offset: enough curvature to separate edges that
  // share an endpoint, never so much that they loop back on themselves.
  const dx = Math.max((x2 - x1) * 0.45, 24);
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

// ── Build ─────────────────────────────────────────────────────────────────────

export function buildGraphModel(data: BlastRadiusResult): BlastGraphModel {
  // 1. Changed symbols that something actually calls — same rule as the tree
  //    view, so the two views never disagree about what this PR touches. An
  //    uncalled symbol draws as a box with no edge leaving it, which a reader
  //    can only resolve by scanning the whole diagram for its missing line.
  //    Deduped by name before the cap, like `buildSymbolRows`: an edge keys off
  //    `viaSymbol` (a name), so two changed symbols sharing a name are one node
  //    here — keeping both emits a duplicate node id and burns a MAX_NODES slot
  //    on an indistinguishable twin.
  const calledSymbols = new Set(data.callers.map((c) => c.viaSymbol));
  const byName = new Map<string, (typeof data.changedSymbols)[number]>();
  for (const s of data.changedSymbols) {
    if (calledSymbols.has(s.name) && !byName.has(s.name)) byName.set(s.name, s);
  }
  const symbolDefs = [...byName.values()]
    .slice(0, MAX_NODES.symbol)
    .map((s) => {
      const callable = s.kind === "function" || s.kind === "method";
      return makeNode(`sym:${s.name}`, "symbol", callable ? `${s.name}()` : s.name);
    });
  const symbolIds = new Set(symbolDefs.map((n) => n.id));

  // 2. Callers, collapsed to one node per (file, enclosing symbol). The API
  //    returns one row PER CALL SITE, so a function calling the changed symbol
  //    three times would otherwise get three identical-looking boxes.
  interface CallerGroup {
    file: string;
    symbol: string;
    lines: number[];
    viaSymbols: Set<string>;
    rank: number;
  }
  const groups = new Map<string, CallerGroup>();
  for (const c of data.callers) {
    const key = `${c.file}|${c.symbol}`;
    const g = groups.get(key);
    if (g) {
      g.lines.push(c.line);
      g.viaSymbols.add(c.viaSymbol);
      g.rank = Math.max(g.rank, c.rank);
    } else {
      groups.set(key, {
        file: c.file,
        symbol: c.symbol,
        lines: [c.line],
        viaSymbols: new Set([c.viaSymbol]),
        rank: c.rank,
      });
    }
  }
  // Rank first, so the cap keeps the callers that matter most.
  const rankedGroups = [...groups.values()].sort((a, b) => b.rank - a.rank);
  const keptGroups = rankedGroups.slice(0, MAX_NODES.caller);

  const callerDefs = keptGroups.map((g) => {
    const lines = [...g.lines].sort((a, b) => a - b);
    const node = makeNode(`caller:${g.file}|${g.symbol}`, "caller", g.symbol);
    // Label stays the bare symbol (as designed); the file:line detail lives in
    // the tooltip, where it can be long without breaking the layout.
    return { ...node, title: `${g.file}:${lines.join(", ")} — ${g.symbol}` };
  });

  // 3. Endpoints, attributed through the RETAINED caller files. `factsByFile`
  //    is keyed by caller file precisely so an endpoint can be traced to the
  //    caller that reaches it, instead of being pinned to an arbitrary symbol.
  const endpointsByCaller = new Map<string, string[]>();
  const endpointTitles: string[] = [];
  const seenEndpoint = new Set<string>();

  if (data.factsByFile) {
    for (const g of keptGroups) {
      const facts = data.factsByFile[g.file];
      if (!facts) continue;
      endpointsByCaller.set(`caller:${g.file}|${g.symbol}`, facts.endpoints);
      for (const e of facts.endpoints) {
        if (seenEndpoint.has(e)) continue;
        seenEndpoint.add(e);
        endpointTitles.push(e);
      }
    }
  } else {
    // No per-file facts (the degraded/ripgrep path): we know WHICH endpoints
    // are impacted but not through which caller, so they hang off the changed
    // symbols instead. Asserting a caller here would be inventing an edge.
    for (const e of data.impactedEndpoints) {
      if (seenEndpoint.has(e)) continue;
      seenEndpoint.add(e);
      endpointTitles.push(e);
    }
  }

  const keptEndpoints = endpointTitles.slice(0, MAX_NODES.endpoint);
  const endpointDefs = keptEndpoints.map((e) => makeNode(`ep:${e}`, "endpoint", e));
  const endpointIds = new Set(endpointDefs.map((n) => n.id));

  // 4. Position: one column per kind, empty columns collapse away.
  const columns = [symbolDefs, callerDefs, endpointDefs].filter(
    (col) => col.length > 0,
  );
  const contentHeight = Math.max(
    0,
    ...columns.map((col) => col.length * NODE_HEIGHT + (col.length - 1) * ROW_GAP),
  );

  const nodes: BlastNode[] = [];
  let x = PADDING;
  for (const col of columns) {
    const colWidth = Math.max(...col.map((n) => n.width));
    const colHeight = col.length * NODE_HEIGHT + (col.length - 1) * ROW_GAP;
    let y = PADDING + (contentHeight - colHeight) / 2;
    for (const n of col) {
      // Centre each box in its column so ragged label widths don't produce a
      // ragged left edge for the outgoing curves.
      nodes.push({ ...n, x: x + (colWidth - n.width) / 2, y });
      y += NODE_HEIGHT + ROW_GAP;
    }
    x += colWidth + COLUMN_GAP;
  }
  const totalWidth = columns.length > 0 ? x - COLUMN_GAP + PADDING : 0;

  const byId = new Map(nodes.map((n) => [n.id, n]));

  // 5. Edges: symbol → caller, then caller → endpoint.
  const edges: BlastEdge[] = [];
  const pushEdge = (fromId: string, toId: string) => {
    const from = byId.get(fromId);
    const to = byId.get(toId);
    if (!from || !to) return;
    edges.push({ id: `${fromId}→${toId}`, path: bezier(from, to) });
  };

  for (const g of keptGroups) {
    const callerId = `caller:${g.file}|${g.symbol}`;
    for (const via of g.viaSymbols) {
      if (symbolIds.has(`sym:${via}`)) pushEdge(`sym:${via}`, callerId);
    }
  }

  if (data.factsByFile) {
    for (const [callerId, eps] of endpointsByCaller) {
      for (const e of eps) {
        if (endpointIds.has(`ep:${e}`)) pushEdge(callerId, `ep:${e}`);
      }
    }
  } else {
    for (const sym of symbolDefs) {
      for (const ep of endpointDefs) pushEdge(sym.id, ep.id);
    }
  }

  const overflow = {
    callers: rankedGroups.length - keptGroups.length,
    endpoints: endpointTitles.length - keptEndpoints.length,
  };
  const overflowRow =
    overflow.callers + overflow.endpoints > 0 ? OVERFLOW_ROW_HEIGHT : 0;

  return {
    nodes,
    edges,
    width: totalWidth,
    height: contentHeight + PADDING * 2 + overflowRow,
    overflow,
  };
}

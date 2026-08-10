import { describe, it, expect } from "vitest";
import type { BlastRadiusResult } from "@devdigest/shared";
import { buildGraphModel, type BlastNode } from "./graph";

const caller = (
  file: string,
  symbol: string,
  line: number,
  rank = 0,
  viaSymbol = "rateLimit",
) => ({ file, symbol, viaSymbol, line, rank });

const DATA: BlastRadiusResult = {
  changedSymbols: [
    { file: "src/middleware/ratelimit.ts", name: "rateLimit", kind: "function" },
  ],
  callers: [
    caller("src/api/public/webhooks.ts", "webhookHandler", 42, 3),
    caller("src/api/public/router.ts", "publicRouter", 12, 5),
  ],
  impactedEndpoints: ["POST /api/public/webhooks", "GET /api/public/health"],
  factsByFile: {
    "src/api/public/webhooks.ts": {
      endpoints: ["POST /api/public/webhooks"],
      crons: [],
    },
    "src/api/public/router.ts": {
      endpoints: ["GET /api/public/health"],
      crons: [],
    },
  },
};

const byKind = (nodes: BlastNode[], kind: BlastNode["kind"]) =>
  nodes.filter((n) => n.kind === kind);

/** Column x-position of a node id, for direction assertions. */
const xOf = (nodes: BlastNode[], id: string) =>
  nodes.find((n) => n.id === id)!.x;

describe("buildGraphModel", () => {
  it("lays out symbol → caller → endpoint left to right", () => {
    const { nodes } = buildGraphModel(DATA);
    const symX = xOf(nodes, "sym:rateLimit");
    const callerX = xOf(nodes, "caller:src/api/public/router.ts|publicRouter");
    const epX = xOf(nodes, "ep:GET /api/public/health");
    expect(symX).toBeLessThan(callerX);
    expect(callerX).toBeLessThan(epX);
  });

  it("suffixes callable changed symbols with ()", () => {
    const [sym] = byKind(buildGraphModel(DATA).nodes, "symbol");
    expect(sym!.label).toBe("rateLimit()");
  });

  it("attributes each endpoint to the caller that reaches it, not to the first symbol", () => {
    const { edges } = buildGraphModel(DATA);
    expect(edges.map((e) => e.id)).toContain(
      "caller:src/api/public/webhooks.ts|webhookHandler→ep:POST /api/public/webhooks",
    );
    // The router's endpoint must NOT hang off the webhook caller.
    expect(edges.map((e) => e.id)).not.toContain(
      "caller:src/api/public/webhooks.ts|webhookHandler→ep:GET /api/public/health",
    );
  });

  it("collapses repeated call sites in one function into a single node", () => {
    const model = buildGraphModel({
      ...DATA,
      callers: [
        caller("src/a.ts", "handler", 10),
        caller("src/a.ts", "handler", 20),
        caller("src/a.ts", "handler", 30),
      ],
      factsByFile: undefined,
    });
    const callers = byKind(model.nodes, "caller");
    expect(callers).toHaveLength(1);
    // The collapsed lines stay reachable in the tooltip.
    expect(callers[0]!.title).toBe("src/a.ts:10, 20, 30 — handler");
  });

  it("keeps the highest-ranked callers when the column cap trims, and reports the drop", () => {
    const many = Array.from({ length: 14 }, (_, i) =>
      caller(`src/f${i}.ts`, `fn${i}`, 1, i),
    );
    const model = buildGraphModel({ ...DATA, callers: many });
    const callers = byKind(model.nodes, "caller");
    expect(callers).toHaveLength(10);
    expect(model.overflow.callers).toBe(4);
    // rank 13 is the top caller; rank 0 must be the one dropped.
    const labels = callers.map((c) => c.label);
    expect(labels).toContain("fn13");
    expect(labels).not.toContain("fn0");
  });

  it("leaves out changed symbols that nothing calls", () => {
    const { nodes } = buildGraphModel({
      ...DATA,
      changedSymbols: [
        ...DATA.changedSymbols,
        { file: "src/middleware/ratelimit.ts", name: "bucketKey", kind: "function" },
      ],
    });
    // An uncalled symbol has no edge, so it would draw as a floating box in the
    // first column — and the tree view already drops it.
    expect(byKind(nodes, "symbol").map((n) => n.id)).toEqual(["sym:rateLimit"]);
  });

  it("hangs endpoints off the changed symbols when factsByFile is absent", () => {
    const { edges } = buildGraphModel({ ...DATA, factsByFile: undefined });
    // No per-file attribution exists, so the only honest source is the symbol.
    expect(edges.map((e) => e.id)).toContain(
      "sym:rateLimit→ep:POST /api/public/webhooks",
    );
  });

  it("truncates long labels but keeps the full text in the title", () => {
    const long = "GET /api/public/very/long/endpoint/path/that/overflows";
    const { nodes } = buildGraphModel({
      ...DATA,
      impactedEndpoints: [long],
      factsByFile: undefined,
    });
    const ep = byKind(nodes, "endpoint")[0]!;
    expect(ep.label.endsWith("…")).toBe(true);
    expect(ep.label.length).toBeLessThan(long.length);
    expect(ep.title).toBe(long);
  });

  it("emits one node per symbol NAME when two files export the same symbol", () => {
    // Node ids are `sym:<name>`, so a duplicate name means a duplicate id —
    // a duplicate React key in BlastGraph and a `byId` entry that silently
    // shadows its twin when edges are resolved.
    const { nodes } = buildGraphModel({
      ...DATA,
      changedSymbols: [
        { file: "src/db/users.ts", name: "update", kind: "function" },
        { file: "src/db/orgs.ts", name: "update", kind: "function" },
      ],
      callers: [caller("src/api/me.ts", "patchMe", 7, 1, "update")],
    });

    expect(byKind(nodes, "symbol").map((n) => n.id)).toEqual(["sym:update"]);
    expect(new Set(nodes.map((n) => n.id)).size).toBe(nodes.length);
  });

  it("returns an empty model when there is nothing to draw", () => {
    const model = buildGraphModel({
      changedSymbols: [],
      callers: [],
      impactedEndpoints: [],
    });
    expect(model.nodes).toHaveLength(0);
    expect(model.edges).toHaveLength(0);
    expect(model.width).toBe(0);
  });
});

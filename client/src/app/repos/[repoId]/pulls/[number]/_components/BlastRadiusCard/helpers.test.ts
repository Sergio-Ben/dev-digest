import { describe, it, expect } from "vitest";
import type { BlastRadiusResult } from "@devdigest/shared";
import { buildCronSet, buildSymbolRows, distinctSymbolNames } from "./helpers";

const DATA: BlastRadiusResult = {
  changedSymbols: [
    { file: "src/middleware/ratelimit.ts", name: "rateLimit", kind: "function" },
  ],
  callers: [
    {
      file: "src/api/public/webhooks.ts",
      symbol: "handleWebhook",
      viaSymbol: "rateLimit",
      line: 42,
      rank: 3,
    },
  ],
  impactedEndpoints: ["POST /webhooks"],
  factsByFile: {
    "src/api/public/webhooks.ts": {
      endpoints: ["POST /webhooks"],
      crons: ["0 * * * *"],
    },
  },
};

describe("buildSymbolRows", () => {
  it("groups callers and attributes endpoints/crons via caller file", () => {
    const rows = buildSymbolRows(DATA);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.name).toBe("rateLimit");
    expect(row.callers).toHaveLength(1);
    expect(row.endpoints).toEqual(["POST /webhooks"]);
    expect(row.crons).toEqual(["0 * * * *"]);
  });

  it("falls back to flat impactedEndpoints when factsByFile is absent", () => {
    const row = buildSymbolRows({ ...DATA, factsByFile: undefined })[0]!;
    expect(row.endpoints).toEqual(["POST /webhooks"]);
    expect(row.crons).toEqual([]);
  });

  it("drops changed symbols that nothing calls", () => {
    const rows = buildSymbolRows({
      ...DATA,
      changedSymbols: [
        ...DATA.changedSymbols,
        { file: "src/middleware/ratelimit.ts", name: "bucketKey", kind: "function" },
      ],
    });

    // `bucketKey` has no caller row, so it never reaches the tree — but the
    // card can still recover the count from changedSymbols.length - rows.length.
    expect(rows.map((r) => r.name)).toEqual(["rateLimit"]);
  });

  it("returns no rows when nothing in the change set has callers", () => {
    expect(buildSymbolRows({ ...DATA, callers: [] })).toEqual([]);
  });

  it("emits one row per NAME when two changed files export the same symbol", () => {
    // `viaSymbol` is a bare name, so both `update`s would claim the same caller
    // rows — identical twins that collide on the React key and on `openSymbol`.
    const rows = buildSymbolRows({
      ...DATA,
      changedSymbols: [
        { file: "src/db/users.ts", name: "update", kind: "function" },
        { file: "src/db/orgs.ts", name: "update", kind: "function" },
      ],
      callers: [
        { file: "src/api/me.ts", symbol: "patchMe", viaSymbol: "update", line: 7, rank: 1 },
      ],
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.file).toBe("src/db/users.ts"); // first wins
  });
});

describe("distinctSymbolNames", () => {
  it("counts names, not entries, so duplicates aren't reported as hidden", () => {
    expect(
      distinctSymbolNames({
        ...DATA,
        changedSymbols: [
          { file: "src/db/users.ts", name: "update", kind: "function" },
          { file: "src/db/orgs.ts", name: "update", kind: "function" },
          { file: "src/db/orgs.ts", name: "remove", kind: "function" },
        ],
      }),
    ).toBe(2);
  });
});

describe("buildCronSet", () => {
  it("collects unique crons from factsByFile", () => {
    expect([...buildCronSet(DATA.factsByFile)]).toEqual(["0 * * * *"]);
    expect(buildCronSet(undefined).size).toBe(0);
  });
});

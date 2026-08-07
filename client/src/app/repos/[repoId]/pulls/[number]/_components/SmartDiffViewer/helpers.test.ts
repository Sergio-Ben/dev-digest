import { describe, it, expect } from "vitest";
import type { PrFile, SmartDiffFile } from "@devdigest/shared";
import { shouldStartOpen, fileAnchorId, indexFilesByPath } from "./helpers";
import { AUTO_EXPAND_MAX_LINES } from "@/components/diff-viewer/constants";

function file(overrides: Partial<SmartDiffFile> = {}): SmartDiffFile {
  return {
    path: "src/foo.ts",
    pseudocode_summary: null,
    additions: 5,
    deletions: 2,
    finding_lines: [],
    ...overrides,
  };
}

describe("shouldStartOpen", () => {
  it("always opens a file that has findings, regardless of role or size", () => {
    const big = file({ finding_lines: [10], additions: AUTO_EXPAND_MAX_LINES + 500 });
    expect(shouldStartOpen(big, "boilerplate")).toBe(true);
    expect(shouldStartOpen(big, "core")).toBe(true);
  });

  it("keeps boilerplate files closed by default (no findings)", () => {
    const small = file({ additions: 2, deletions: 0 });
    expect(shouldStartOpen(small, "boilerplate")).toBe(false);
  });

  it("opens core/wiring files under the auto-expand budget", () => {
    const small = file({ additions: 10, deletions: 5 });
    expect(shouldStartOpen(small, "core")).toBe(true);
    expect(shouldStartOpen(small, "wiring")).toBe(true);
  });

  it("keeps large core/wiring files closed past the auto-expand budget", () => {
    const large = file({ additions: AUTO_EXPAND_MAX_LINES + 100, deletions: 0 });
    expect(shouldStartOpen(large, "core")).toBe(false);
  });
});

describe("fileAnchorId", () => {
  it("produces a stable, DOM-safe id from a path", () => {
    expect(fileAnchorId("src/app/foo/Bar.tsx")).toBe("sd-src-app-foo-Bar-tsx");
  });

  it("is stable across calls for the same path", () => {
    expect(fileAnchorId("a/b.ts")).toBe(fileAnchorId("a/b.ts"));
  });
});

describe("indexFilesByPath", () => {
  it("maps PrFiles by path for O(1) lookup", () => {
    const files: PrFile[] = [
      { path: "a.ts", additions: 1, deletions: 0, patch: "@@ -1 +1 @@\n+x" },
      { path: "b.ts", additions: 2, deletions: 1, patch: null },
    ];
    const idx = indexFilesByPath(files);
    expect(idx.get("a.ts")?.additions).toBe(1);
    expect(idx.get("b.ts")?.deletions).toBe(1);
    expect(idx.get("missing.ts")).toBeUndefined();
  });
});

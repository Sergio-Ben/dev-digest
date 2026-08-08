import { describe, it, expect } from "vitest";
import type { ConventionCandidate } from "@devdigest/shared";
import { evidenceUrl } from "./helpers";

const REPO = { full_name: "acme/payments-api", default_branch: "main" };

const candidate = (patch: Partial<ConventionCandidate> = {}): ConventionCandidate => ({
  id: "c1",
  category: "async-await",
  rule: "Always await database calls.",
  evidencePath: "src/api/users.ts",
  evidenceSnippet: "await db.users.find(id);",
  evidenceStartLine: 23,
  evidenceEndLine: 31,
  confidence: 0.9,
  status: "pending",
  skillId: null,
  ...patch,
});

describe("evidenceUrl", () => {
  it("anchors the blob link at the verified line range", () => {
    expect(evidenceUrl(REPO, candidate())).toBe(
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L23-L31",
    );
  });

  it("emits a single anchor for a one-line match", () => {
    expect(evidenceUrl(REPO, candidate({ evidenceEndLine: 23 }))).toBe(
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts#L23",
    );
  });

  it("omits the anchor when the range is unknown", () => {
    const c = candidate({ evidenceStartLine: null, evidenceEndLine: null });
    expect(evidenceUrl(REPO, c)).toBe(
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts",
    );
  });

  it("falls back to HEAD when the repo has no default branch", () => {
    expect(evidenceUrl({ ...REPO, default_branch: "" }, candidate())).toContain("/blob/HEAD/");
  });

  it("returns null while the repo is still loading", () => {
    expect(evidenceUrl(null, candidate())).toBeNull();
    expect(evidenceUrl(undefined, candidate())).toBeNull();
  });

  it("encodes path segments but keeps the separators", () => {
    const c = candidate({ evidencePath: "src/app/[repoId]/page tsx.ts" });
    expect(evidenceUrl(REPO, c)).toContain("/src/app/%5BrepoId%5D/page%20tsx.ts#L23-L31");
  });
});

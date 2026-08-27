import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta, Finding } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";
import { PRRow } from "./PRRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// FindingsCell fetches the finding bodies for its hover card lazily via
// usePrReviews (a React Query hook). Mock it so these tests need no
// QueryClientProvider; `mockReviews` is what the popover renders.
let mockReviews: { findings: Finding[] }[] = [];
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: () => ({ data: mockReviews, isLoading: false }),
}));

afterEach(() => {
  cleanup();
  mockReviews = [];
});

let seq = 0;
const FINDING = (over: Partial<Finding>): Finding => ({
  id: `f${seq++}`,
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 12,
  end_line: 12,
  rationale: "A live key is committed.",
  suggestion: null,
  confidence: 0.98,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  ...over,
});

const PR = (over: Partial<PrMeta>): PrMeta => ({
  id: "pr-1",
  number: 482,
  title: "Add rate limiting to public API endpoints",
  author: "marisa.koch",
  branch: "feat/rate-limit",
  base: "main",
  head_sha: "abc1234",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "needs_review",
  opened_at: null,
  updated_at: new Date().toISOString(),
  score: 61,
  cost_usd: 0.014,
  findings: null,
  ...over,
});

function renderRow(pr: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <PRRow pr={pr} repoId="r1" />
    </NextIntlClientProvider>,
  );
}

describe("PRRow — FINDINGS cell", () => {
  it("shows per-severity count chips when the PR has findings", () => {
    // pr.findings is a per-severity rollup from the list endpoint, not the
    // finding bodies (those load lazily on hover — see usePrReviews).
    renderRow(PR({ findings: { critical: 2, warning: 1, suggestion: 0 } }));
    // Two chips (CRITICAL=2, WARNING=1); SUGGESTION omitted (zero).
    expect(screen.getByTitle("Critical")).toHaveTextContent("2");
    expect(screen.getByTitle("Warning")).toHaveTextContent("1");
    expect(screen.queryByTitle("Suggestion")).not.toBeInTheDocument();
  });

  it("reveals the findings popover on hover", () => {
    mockReviews = [{ findings: [FINDING({ title: "Hardcoded Stripe secret key" })] }];
    renderRow(PR({ findings: { critical: 1, warning: 0, suggestion: 0 } }));
    expect(screen.queryByText("Hardcoded Stripe secret key")).not.toBeInTheDocument();
    // Hover the FindingsCell wrapper (the chip's parent carries the handlers).
    const chip = screen.getByTitle("Critical");
    fireEvent.mouseOver(chip.parentElement!);
    expect(screen.getByText("1 findings")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
  });

  it("renders '—' in the findings cell when the PR is reviewed but clean", () => {
    renderRow(PR({ score: 95, findings: { critical: 0, warning: 0, suggestion: 0 } }));
    // No severity chips; score (95) still renders, so the only em dash is the
    // findings cell.
    expect(screen.queryByTitle(/critical|warning|suggestion/i)).not.toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

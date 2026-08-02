import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsTab } from "./FindingsTab";

afterEach(cleanup);

function finding(id: string, severity: FindingRecord["severity"], title: string, reviewId: string): FindingRecord {
  return {
    id,
    severity,
    category: "security",
    title,
    file: "src/config.ts",
    start_line: 1,
    end_line: 1,
    rationale: "why",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: reviewId,
    accepted_at: null,
    dismissed_at: null,
  };
}

function review(id: string, agent: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id,
    pr_id: "pr1",
    run_id: `run-${id}`,
    agent_name: agent,
    kind: "review",
    verdict: "comment",
    summary: "summary",
    score: 70,
    created_at: "2026-06-13T20:52:51.000Z",
    findings,
  } as ReviewRecord;
}

// Run A: 2 CRITICAL + 1 WARNING. Run B: WARNING only — it must disappear
// entirely when CRITICAL is selected.
const RUNS: ReviewRecord[] = [
  review("a", "Security Reviewer", [
    finding("f1", "CRITICAL", "Hardcoded secret", "a"),
    finding("f2", "CRITICAL", "Exfil path", "a"),
    finding("f3", "WARNING", "Missing index", "a"),
  ]),
  review("b", "Performance Reviewer", [finding("f4", "WARNING", "N+1 query", "b")]),
];

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsTab
        prId="pr1"
        liveRunIds={[]}
        reviewRunning={false}
        lethalTrifecta={[]}
        runs={RUNS}
        prRuns={[]}
        prCommits={[]}
        cancelMutation={{ mutate: vi.fn(), isPending: false } as never}
        onOpenTrace={vi.fn()}
        onDelete={vi.fn()}
        onRunDone={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("FindingsTab severity counters", () => {
  it("counts every finding across all runs", () => {
    renderTab();
    expect(screen.getByText("2 CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("2 WARNING")).toBeInTheDocument();
    expect(screen.queryByText(/SUGGESTION/)).not.toBeInTheDocument();
  });

  it("shows only the picked severity and hides runs without it", () => {
    renderTab();
    fireEvent.click(screen.getByText("2 CRITICAL"));

    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Exfil path")).toBeInTheDocument();
    expect(screen.queryByText("Missing index")).not.toBeInTheDocument();
    // The WARNING-only run is gone, header and all.
    expect(screen.queryByText("Performance Reviewer")).not.toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
  });

  it("keeps the surviving run's header counts at run totals, not filtered ones", () => {
    renderTab();
    fireEvent.click(screen.getByText("2 CRITICAL"));
    // Both chrome spots — the accordion header and the VerdictBanner — must
    // still read the run's totals (3 findings), not the 2 filtered cards below.
    expect(screen.getAllByText("3 findings · 2 blockers")).toHaveLength(2);
    expect(screen.queryByText("2 findings · 2 blockers")).not.toBeInTheDocument();
  });

  it("restores everything when the active chip is clicked again", () => {
    renderTab();
    fireEvent.click(screen.getByText("2 CRITICAL"));
    fireEvent.click(screen.getByText("2 CRITICAL"));
    expect(screen.getByText("Performance Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Missing index")).toBeInTheDocument();
  });

  it("switches to the other level rather than combining", () => {
    renderTab();
    fireEvent.click(screen.getByText("2 CRITICAL"));
    fireEvent.click(screen.getByText("2 WARNING"));
    expect(screen.getByText("Missing index")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
  });

  it("auto-opens a collapsed run when a filter is applied", () => {
    renderTab();
    // Run B starts collapsed (only i === 0 is open by default).
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("2 WARNING"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
  });

  it("marks the active chip as selected", () => {
    renderTab();
    const group = screen.getByRole("group", { name: "Filter findings by severity" });
    expect(within(group).getAllByRole("button")).toHaveLength(2);
  });
});

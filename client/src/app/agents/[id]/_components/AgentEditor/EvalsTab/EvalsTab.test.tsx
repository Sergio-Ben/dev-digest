import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase, EvalDashboard, EvalBatchRow, EvalRunRecord } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/eval.json";

const runMutate = vi.fn();
const runAllMutate = vi.fn();
const deleteMutate = vi.fn();

let cases: EvalCase[] = [];
let dashboard: (EvalDashboard & { batches: EvalBatchRow[] }) | undefined;

vi.mock("@/lib/hooks/evals", () => ({
  useEvalCases: () => ({
    data: cases,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useEvalDashboard: () => ({
    data: dashboard,
    isLoading: false,
    isError: false,
  }),
  useRunEvalCase: () => ({ mutate: runMutate, isPending: false }),
  useRunAgentEvals: () => ({ mutate: runAllMutate, isPending: false }),
  useDeleteEvalCase: () => ({ mutate: deleteMutate, isPending: false }),
}));

// The tab now opens `EvalCaseEditorModal` in place ("New case"/"Edit") rather
// than navigating to a `/eval/cases/*` route — that component owns its own
// data fetching (`useAgent`, `useEvalCase`, mutation hooks) and is covered by
// its own test suite, so it's stubbed here to keep this file focused on the
// tab's own responsibility: which case/mode it opens the modal with.
vi.mock("@/app/eval/cases/_components/EvalCaseEditor", () => ({
  EvalCaseEditorModal: ({ caseId, onClose }: { caseId: string | null; onClose: () => void }) => (
    <div role="dialog" aria-label="eval-case-editor-modal">
      <span>{`modal target: ${caseId ?? "new"}`}</span>
      <button onClick={onClose}>Close modal</button>
    </div>
  ),
}));

import { EvalsTab } from "./EvalsTab";

function renderTab() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalsTab agentId="agent-1" />
    </NextIntlClientProvider>,
  );
}

const expected = (severity: "CRITICAL" | "WARNING" | "SUGGESTION", category: string) => [
  { severity, category, title: "t", file: "src/a.ts", start_line: 1, end_line: 2 },
];

function makeCase(id: string, name: string): EvalCase {
  return {
    id,
    owner_kind: "agent",
    owner_id: "agent-1",
    name,
    input_diff: "diff --git a/a.ts b/a.ts",
    input_files: null,
    input_meta: null,
    expected_output: expected("CRITICAL", "security"),
    notes: null,
  };
}

function makeRun(id: string, caseId: string, ranAt: string, pass: boolean | null): EvalRunRecord {
  return {
    id,
    case_id: caseId,
    case_name: null,
    ran_at: ranAt,
    actual_output: [{ file: "src/a.ts" }],
    pass,
    recall: pass ? 1 : 0.5,
    precision: pass ? 1 : 0.6,
    citation_accuracy: pass ? 1 : 0.7,
    duration_ms: 300,
    cost_usd: 0.01,
  };
}

const BATCH = (id: string, ranAt: string, tracesPassed: number): EvalBatchRow => ({
  batch_id: id,
  agent_id: "agent-1",
  agent_version: 1,
  ran_at: ranAt,
  recall: 0.8,
  precision: 0.75,
  citation_accuracy: 0.9,
  traces_passed: tracesPassed,
  traces_total: 10,
  cost_usd: 0.05,
});

beforeEach(() => {
  runMutate.mockClear();
  runAllMutate.mockClear();
  deleteMutate.mockClear();

  // 5 cases: 4 with a latest run (mixed pass/fail), 1 never run (AC-7/8).
  cases = [
    makeCase("case-1", "stripe-key-leak"),
    makeCase("case-2", "sql-injection"),
    makeCase("case-3", "xss-in-template"),
    makeCase("case-4", "missing-auth-check"),
    makeCase("case-5", "never-run-case"),
  ];

  dashboard = {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: 5,
    current: {
      recall: 0.82,
      precision: 0.74,
      citation_accuracy: 0.91,
      traces_passed: 9,
      traces_total: 10,
      cost_usd: 0.2,
    },
    // Signed deltas vs. the previous batch (AC-30): recall up, precision down.
    delta: { recall: 0.04, precision: -0.03, citation_accuracy: 0 },
    trend: [
      { ran_at: "2026-08-01T00:00:00.000Z", recall: 0.7, precision: 0.7, citation_accuracy: 0.8, pass_rate: 0.7, cost_usd: 0.01 },
      { ran_at: "2026-08-10T00:00:00.000Z", recall: 0.82, precision: 0.74, citation_accuracy: 0.91, pass_rate: 0.9, cost_usd: 0.02 },
    ],
    recent_runs: [
      makeRun("run-1", "case-1", "2026-08-10T12:00:00.000Z", true),
      makeRun("run-2", "case-2", "2026-08-10T12:05:00.000Z", true),
      makeRun("run-3", "case-3", "2026-08-10T12:10:00.000Z", false),
      makeRun("run-4", "case-4", "2026-08-10T12:15:00.000Z", true),
      // case-5 deliberately has no run record → never-run.
    ],
    alert: null,
    // traces_passed delta (9 - 7 = 2) deliberately differs from the
    // recall/precision deltas below so the assertions can't collide.
    batches: [BATCH("batch-new", "2026-08-10T12:00:00.000Z", 9), BATCH("batch-old", "2026-08-01T00:00:00.000Z", 7)],
  };
});
afterEach(cleanup);

describe("EvalsTab", () => {
  it("renders one row per eval case, with header New/Run-all controls keyboard-operable", () => {
    renderTab();

    // AC-7: 5 cases -> 5 rows.
    expect(screen.getAllByRole("listitem")).toHaveLength(5);

    // AC-9: header actions exist as real, named, focusable <button> elements —
    // native buttons are keyboard-operable (Enter/Space) by browser default,
    // so a semantic button reachable by accessible name is the RTL-level
    // proof of keyboard operability; the click below confirms the wiring.
    const newBtn = screen.getByRole("button", { name: /new eval case/i });
    const runAllBtn = screen.getByRole("button", { name: /run all evals/i });
    expect(newBtn).toBeInTheDocument();
    expect(runAllBtn).toBeInTheDocument();
    newBtn.focus();
    expect(newBtn).toHaveFocus();

    // "New case" opens the eval-case editor modal blank (no route navigation).
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(newBtn);
    expect(screen.getByText("modal target: new")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close modal/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    fireEvent.click(runAllBtn);
    expect(runAllMutate).toHaveBeenCalledTimes(1);

    // Per-row actions (AC-9): also real, focusable, named buttons.
    const firstRow = screen.getAllByRole("listitem")[0]!;
    const editBtn = within(firstRow).getByRole("button", { name: /edit/i });
    editBtn.focus();
    expect(editBtn).toHaveFocus();
    fireEvent.click(editBtn);
    expect(screen.getByText("modal target: case-1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /close modal/i }));

    const runBtn = within(firstRow).getByRole("button", { name: /run/i });
    fireEvent.click(runBtn);
    expect(runMutate).toHaveBeenCalledWith(
      { id: "case-1", agentId: "agent-1" },
      expect.objectContaining({ onSettled: expect.any(Function) }),
    );

    const deleteBtn = within(firstRow).getByRole("button", { name: /delete/i });
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(deleteBtn);
    expect(confirmSpy).toHaveBeenCalled();
    expect(deleteMutate).toHaveBeenCalledWith({ id: "case-1", agentId: "agent-1" });
    confirmSpy.mockRestore();
  });

  it("shows a distinct never-run state with no metric numbers, and expected/got + severity·category for run cases", () => {
    renderTab();

    const rows = screen.getAllByRole("listitem");
    const neverRunRow = rows.find((r) => within(r).queryByText("never run"));
    expect(neverRunRow).toBeTruthy();

    // AC-8: the never-run row shows the label and NO "expected/got" numbers.
    expect(within(neverRunRow!).queryByText(/expected \d+/)).not.toBeInTheDocument();

    // A case with a run shows a pass/fail status icon (accessible name, not
    // colour-only) + "expected N · got M" + the lead severity·category tag
    // (AC-7).
    const passedRow = rows.find((r) => within(r).queryByRole("img", { name: "passed" }));
    expect(passedRow).toBeTruthy();
    expect(within(passedRow!).getByText(/expected 1 finding, got 1/)).toBeInTheDocument();
    expect(within(passedRow!).getByText(/security/)).toBeInTheDocument();

    const failedRow = rows.find((r) => within(r).queryByRole("img", { name: "failed" }));
    expect(failedRow).toBeTruthy();
  });

  it("renders batch metrics with signed deltas (icon differs by sign, not colour alone)", () => {
    const { container } = renderTab();

    // AC-30: recall/precision/citation/traces-passed metric cards.
    expect(screen.getByText("RECALL")).toBeInTheDocument();
    expect(screen.getByText("PRECISION")).toBeInTheDocument();
    expect(screen.getByText("CITATION ACCURACY")).toBeInTheDocument();
    expect(screen.getByText("TRACES PASSED")).toBeInTheDocument();

    // Recall delta is +4 (up), precision delta is -3 (down): the sign is
    // conveyed by a distinct icon (lucide-arrow-up vs lucide-arrow-down), not
    // colour alone — both the value text and a differing icon are present.
    expect(screen.getByText("4.00")).toBeInTheDocument();
    expect(screen.getByText("3.00")).toBeInTheDocument();
    expect(container.querySelector(".lucide-arrow-up")).toBeTruthy();
    expect(container.querySelector(".lucide-arrow-down")).toBeTruthy();

    // AC-31: run-history list + metric-trend chart both render.
    expect(screen.getByText("Metric trend")).toBeInTheDocument();
    expect(screen.getByText("Recent runs")).toBeInTheDocument();
    expect(screen.getAllByRole("row").length).toBeGreaterThan(1); // header + data rows

    // "View full dashboard →" links to the per-agent detail route.
    const dashboardLink = screen.getByRole("link", { name: /view full dashboard/i });
    expect(dashboardLink).toHaveAttribute("href", "/eval/agent-1");
  });
});

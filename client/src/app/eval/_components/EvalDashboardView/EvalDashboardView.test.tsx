import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalDashboardCross } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

const runAllMutate = vi.fn();
let dashboard: EvalDashboardCross | undefined;
let isLoading = false;
let isError = false;

vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboardCross: () => ({
    data: dashboard,
    isLoading,
    isError,
    error: null,
    refetch: vi.fn(),
  }),
  useRunAllAgents: () => ({ mutate: runAllMutate, isPending: false }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { EvalDashboardView } from "./EvalDashboardView";

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboardView />
    </NextIntlClientProvider>,
  );
}

const trendPoint = (recall: number) => ({
  ran_at: "2026-08-01T00:00:00.000Z",
  recall,
  precision: 0.8,
  citation_accuracy: 0.9,
  pass_rate: 0.8,
  cost_usd: 0.01,
});

beforeEach(() => {
  runAllMutate.mockClear();
  isLoading = false;
  isError = false;
  dashboard = {
    agents: [
      {
        agent_id: "agent-1",
        name: "Security Reviewer",
        model: "gpt-5.4",
        latest: {
          batch_id: "batch-old",
          agent_id: "agent-1",
          agent_version: 3,
          ran_at: "2026-08-10T12:00:00.000Z",
          recall: 0.7,
          precision: 0.8,
          citation_accuracy: 0.9,
          traces_passed: 8,
          traces_total: 10,
          cost_usd: 0.05,
        },
        trend: [trendPoint(0.6), trendPoint(0.7)],
      },
      {
        agent_id: "agent-2",
        name: "Style Reviewer",
        model: "claude-opus",
        latest: null,
        trend: [],
      },
    ],
    recent_batches: [
      {
        batch_id: "batch-old",
        agent_id: "agent-1",
        agent_version: 3,
        ran_at: "2026-08-10T12:00:00.000Z",
        recall: 0.7,
        precision: 0.8,
        citation_accuracy: 0.9,
        traces_passed: 8,
        traces_total: 10,
        cost_usd: 0.05,
      },
      {
        batch_id: "batch-new",
        agent_id: "agent-2",
        agent_version: 1,
        ran_at: "2026-08-20T09:00:00.000Z",
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        traces_passed: 4,
        traces_total: 4,
        cost_usd: 0.02,
      },
    ],
  };
});
afterEach(cleanup);

describe("EvalDashboardView", () => {
  it("lists each agent once with its latest metrics, and shows the empty state for a never-run agent", () => {
    renderView();

    // AC-36: each agent gets exactly one summary card, with its latest
    // recall/precision/citation + version. Each card is a link to that
    // agent's per-agent eval detail page.
    const securityCard = screen.getByRole("link", { name: "View Security Reviewer eval detail" });
    expect(securityCard).toHaveAttribute("href", "/eval/agent-1");
    expect(within(securityCard).getByText("gpt-5.4")).toBeInTheDocument();
    expect(within(securityCard).getByText("70%")).toBeInTheDocument();
    expect(within(securityCard).getByText(/v3 ·/)).toBeInTheDocument();

    // AC-38: an agent with zero batches renders "no runs yet", not blank/fabricated metrics.
    const styleCard = screen.getByRole("link", { name: "View Style Reviewer eval detail" });
    expect(styleCard).toHaveAttribute("href", "/eval/agent-2");
    expect(within(styleCard).getByText("claude-opus")).toBeInTheDocument();
    expect(
      within(styleCard).getByText("No runs yet. Create an eval case and run it."),
    ).toBeInTheDocument();
  });

  it("tops the recent-runs list with the most recent batch across all agents", () => {
    renderView();

    // AC-37: batch-new (2026-08-20) ran after batch-old (2026-08-10) despite
    // appearing second in the fixture, so it must render first in the table.
    const rows = screen.getAllByRole("row").slice(1); // drop the header row
    expect(within(rows[0]!).getByText("Style Reviewer")).toBeInTheDocument();
    expect(within(rows[1]!).getByText("Security Reviewer")).toBeInTheDocument();
  });

  it("triggers the bounded run-all batch from the Run all agents action", () => {
    renderView();

    // AC-39.
    fireEvent.click(screen.getByRole("button", { name: /run all agents/i }));
    expect(runAllMutate).toHaveBeenCalledTimes(1);
  });
});

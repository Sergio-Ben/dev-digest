import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, EvalDashboard, EvalBatchRow } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";

const runMutate = vi.fn();
const pushMock = vi.fn();

let agent: Agent | undefined;
let agents: Agent[] | undefined;
let dashboard: (EvalDashboard & { batches: EvalBatchRow[] }) | undefined;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgent: () => ({ data: agent, isLoading: false, isError: false }),
  useAgents: () => ({ data: agents }),
}));

vi.mock("@/lib/hooks/evals", () => ({
  useEvalDashboard: () => ({
    data: dashboard,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useRunAgentEvals: () => ({ mutate: runMutate, isPending: false }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/app/eval/compare/_components/EvalCompareModal", () => ({
  EvalCompareModal: ({ batchA, batchB, onClose }: { batchA: string; batchB: string; onClose: () => void }) => (
    <div role="dialog" aria-label="compare-modal">
      {`compare ${batchA} vs ${batchB}`}
      <button onClick={onClose}>close</button>
    </div>
  ),
}));

import { EvalAgentDetailView } from "./EvalAgentDetailView";

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalAgentDetailView agentId="agent-1" />
    </NextIntlClientProvider>,
  );
}

/** Matches an element whose own combined text content (across its nested
 *  spans, e.g. MetricCard's value + suffix) equals `text` exactly — plain
 *  `getByText` only looks at an element's direct text-node children, which
 *  MetricCard splits across a value span and a nested suffix span. */
function getByFullText(text: string) {
  return screen.getByText((_content, element) => element?.textContent?.trim() === text);
}

const trendPoint = (recall: number) => ({
  ran_at: "2026-08-01T00:00:00.000Z",
  recall,
  precision: 0.8,
  citation_accuracy: 0.9,
  pass_rate: 0.8,
  cost_usd: 0.01,
});

const batch = (overrides: Partial<EvalBatchRow>): EvalBatchRow => ({
  batch_id: "batch-1",
  agent_id: "agent-1",
  agent_version: 1,
  ran_at: "2026-08-01T00:00:00.000Z",
  recall: 0.7,
  precision: 0.8,
  citation_accuracy: 0.9,
  traces_passed: 8,
  traces_total: 10,
  cost_usd: 0.05,
  ...overrides,
});

beforeEach(() => {
  runMutate.mockClear();
  pushMock.mockClear();
  agent = { id: "agent-1", name: "Security Reviewer", model: "gpt-4.1" } as Agent;
  agents = [agent, { id: "agent-2", name: "Style Reviewer", model: "claude-opus" } as Agent];
  dashboard = {
    owner_kind: "agent",
    owner_id: "agent-1",
    cases_total: 42,
    current: {
      recall: 0.82,
      precision: 0.75,
      citation_accuracy: 0.9,
      traces_passed: 8,
      traces_total: 10,
      cost_usd: 0.5,
    },
    delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
    trend: [trendPoint(0.7), trendPoint(0.82)],
    recent_runs: [],
    alert: "Precision dipped 2pts on v7 — a new false positive slipped in. Recall and citation both up.",
    batches: [
      batch({ batch_id: "batch-old", agent_version: 6, ran_at: "2026-08-01T00:00:00.000Z" }),
      batch({ batch_id: "batch-new", agent_version: 7, ran_at: "2026-08-10T00:00:00.000Z" }),
    ],
  };
});
afterEach(cleanup);

describe("EvalAgentDetailView", () => {
  it("renders the agent's name, model, and current metrics, and shows the alert banner when the dashboard flags one", () => {
    renderView();

    expect(screen.getByRole("heading", { name: "Security Reviewer" })).toBeInTheDocument();
    expect(screen.getByText("gpt-4.1")).toBeInTheDocument();
    expect(getByFullText("82%")).toBeInTheDocument();

    expect(screen.getByRole("status")).toHaveTextContent(/Precision dipped 2pts on v7/);
  });

  it("renders nothing for the alert banner when the dashboard has no alert", () => {
    dashboard = { ...dashboard!, alert: null };
    renderView();

    expect(screen.queryByText(/Precision dipped 2pts/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("enables Compare only once exactly two runs are selected, and opens the compare modal with the picked batches", () => {
    renderView();

    const compareButton = screen.getByRole("button", { name: "Compare" });
    expect(compareButton).toBeDisabled();

    // Rows render most-recent-first: batch-new (2026-08-10) then batch-old (2026-08-01).
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]!);
    expect(compareButton).toBeDisabled();
    fireEvent.click(checkboxes[1]!);
    expect(compareButton).toBeEnabled();

    fireEvent.click(compareButton);
    expect(screen.getByRole("dialog", { name: "compare-modal" })).toHaveTextContent(
      "compare batch-new vs batch-old",
    );
  });

  it("triggers the run-eval mutation from the header's Run eval button", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /run eval/i }));
    expect(runMutate).toHaveBeenCalledTimes(1);
  });
});

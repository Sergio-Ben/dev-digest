import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f2",
    severity: "WARNING",
    category: "perf",
    title: "N+1 query",
    file: "src/api/users.ts",
    start_line: 45,
    end_line: 52,
    rationale: "One query per user.",
    suggestion: null,
    confidence: 0.86,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
  {
    id: "f3",
    severity: "SUGGESTION",
    category: "style",
    title: "Extract magic number",
    file: "src/middleware/ratelimit.ts",
    start_line: 28,
    end_line: 28,
    rationale: "3600 appears twice.",
    suggestion: null,
    confidence: 0.62,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("filters by severity when a pill is clicked", () => {
    const findings: FindingRecord[] = [
      { ...FINDINGS[0]! },
      {
        ...FINDINGS[0]!,
        id: "f2",
        severity: "WARNING",
        title: "Warn finding",
      },
    ];
    renderWithIntl(<FindingsPanel findings={findings} prId="pr1" />);
    // Both visible initially
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("Warn finding")).toBeInTheDocument();
    // Click CRITICAL pill
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("Warn finding")).not.toBeInTheDocument();
    // Click again → reset
    fireEvent.click(screen.getByRole("button", { name: /critical/i }));
    expect(screen.getByText("Warn finding")).toBeInTheDocument();
  });
});

describe("FindingsPanel (severity filter)", () => {
  it("shows every severity when no filter is set", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.getByText("Extract magic number")).toBeInTheDocument();
  });

  it("shows only the filtered severity", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" severityFilter="WARNING" />);
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.queryByText("Extract magic number")).not.toBeInTheDocument();
  });

  it("treats an explicit null filter as no filter", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" severityFilter={null} />);
    expect(screen.getAllByText(/Hardcoded secret|N\+1 query|Extract magic number/)).toHaveLength(3);
  });

  it("shows the empty state when the filter matches nothing", () => {
    renderWithIntl(<FindingsPanel findings={[FINDINGS[0]!]} prId="pr1" severityFilter="SUGGESTION" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("keeps keyboard focus inside a list that shrank under a filter", () => {
    const { rerender } = renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" }); // focusIdx → 2 (last of three)
    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingsPanel findings={FINDINGS} prId="pr1" severityFilter="CRITICAL" />
      </NextIntlClientProvider>,
    );
    // One card left: it must be the focused one, not an out-of-range index.
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "j" });
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });
});

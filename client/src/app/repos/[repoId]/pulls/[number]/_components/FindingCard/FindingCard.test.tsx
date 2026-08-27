import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";

// FindingCard now calls `useEvalCaseFromFinding` on every render (T13), so
// every test in this file needs a mocked react-query mutation — there's no
// QueryClientProvider in these smoke tests, and the real hook would throw
// "No QueryClient set" without one.
vi.mock("../../../../../../../lib/hooks/evals", () => ({
  useEvalCaseFromFinding: vi.fn(),
}));

import { useEvalCaseFromFinding } from "../../../../../../../lib/hooks/evals";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const DECIDED_FINDING: FindingRecord = {
  ...FINDING,
  accepted_at: "2026-08-20T10:00:00Z",
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Configure the mocked `useEvalCaseFromFinding` return value for one test
 *  and hand back the `mutate` spy so the test can assert on it. */
function mockEvalCase(overrides: Partial<ReturnType<typeof useEvalCaseFromFinding>> = {}) {
  const mutate = vi.fn();
  vi.mocked(useEvalCaseFromFinding).mockReturnValue({
    mutate,
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
    ...overrides,
  } as ReturnType<typeof useEvalCaseFromFinding>);
  return mutate;
}

beforeEach(() => {
  mockEvalCase();
});

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — turn into eval case (T13, AC-4)", () => {
  it("shows the 'turn into eval case' action", () => {
    renderWithIntl(<FindingCard f={DECIDED_FINDING} defaultExpanded onAction={() => {}} />);
    expect(screen.getByRole("button", { name: "Turn into eval case" })).toBeInTheDocument();
  });

  it("clicking a decided finding calls the create-from-finding mutation", () => {
    const mutate = mockEvalCase();
    renderWithIntl(<FindingCard f={DECIDED_FINDING} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("surfaces the server's 'decide first' prompt for an undecided finding and creates no case", () => {
    const mutate = mockEvalCase({
      isError: true,
      error: new Error("Decide first: accept or dismiss this finding before creating an eval case."),
    });
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Turn into eval case" }));

    // Client still calls through — AC-4 is enforced server-side, not
    // duplicated client-side — but no case is ever created for this finding.
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/decide first/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("persists the captured state across a reload: a finding carrying eval_case_id shows the button as done and non-clickable", () => {
    const mutate = mockEvalCase();
    // A finding the server already reports as captured (`eval_case_id`) — i.e.
    // exactly what a reload after a successful capture returns.
    const CAPTURED: FindingRecord = { ...DECIDED_FINDING, eval_case_id: "ec-1" };
    renderWithIntl(<FindingCard f={CAPTURED} defaultExpanded onAction={() => {}} />);

    const button = screen.getByRole("button", { name: "Turn into eval case" });
    expect(button).toBeDisabled();
    // Persisted "eval case" tag + status, without ever re-firing the mutation.
    expect(screen.getByText("eval case")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Eval case created");
    fireEvent.click(button);
    expect(mutate).not.toHaveBeenCalled();
  });
});

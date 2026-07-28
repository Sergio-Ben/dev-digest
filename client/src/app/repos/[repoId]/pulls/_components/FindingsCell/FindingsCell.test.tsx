import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/prReview.json";

const usePrReviews = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: (prId: string | null) => usePrReviews(prId),
}));

import { FindingsCell } from "./FindingsCell";

afterEach(() => {
  cleanup();
  usePrReviews.mockReset();
});

const PR = {
  id: "pr1",
  number: 482,
  title: "Add rate limiting",
  author: "marisa.koch",
  branch: "feat/rl",
  base: "main",
  head_sha: "abc",
  additions: 247,
  deletions: 38,
  files_count: 9,
  status: "needs_review",
  findings: { critical: 2, warning: 1, suggestion: 0 },
} as PrMeta;

function renderCell(pr: PrMeta) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsCell pr={pr} />
    </NextIntlClientProvider>,
  );
}

describe("FindingsCell", () => {
  it("renders a count per non-zero severity and skips the zero one", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false });
    const { container } = renderCell(PR);
    expect(container.textContent).toBe("21");
    expect(screen.getByTitle("Critical")).toBeInTheDocument();
    expect(screen.getByTitle("Warning")).toBeInTheDocument();
    expect(screen.queryByTitle("Suggestion")).not.toBeInTheDocument();
  });

  it("renders a dash when the PR has no findings", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false });
    renderCell({ ...PR, findings: null } as PrMeta);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("does not fetch until hovered, then fetches that PR", () => {
    usePrReviews.mockReturnValue({ data: undefined, isLoading: false });
    const { container } = renderCell(PR);
    expect(usePrReviews).toHaveBeenLastCalledWith(null);

    fireEvent.mouseEnter(container.firstChild as Element);
    expect(usePrReviews).toHaveBeenLastCalledWith("pr1");
  });

  it("shows the findings preview on hover, worst first", () => {
    usePrReviews.mockReturnValue({
      isLoading: false,
      data: [
        {
          id: "r1",
          findings: [
            {
              id: "f1",
              severity: "WARNING",
              category: "perf",
              title: "N+1 query",
              file: "src/api/users.ts",
              start_line: 45,
              end_line: 52,
              rationale: "One query per user.",
              confidence: 0.86,
            },
            {
              id: "f2",
              severity: "CRITICAL",
              category: "security",
              title: "Hardcoded secret",
              file: "src/config.ts",
              start_line: 12,
              end_line: 12,
              rationale: "A live key is committed.",
              confidence: 0.98,
            },
          ],
        },
      ],
    });
    const { container } = renderCell(PR);
    fireEvent.mouseEnter(container.firstChild as Element);

    expect(screen.getByText("2 findings")).toBeInTheDocument();
    expect(screen.getByText("src/config.ts:12")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts:45-52")).toBeInTheDocument();
    // CRITICAL sorts above WARNING regardless of arrival order.
    const titles = screen.getAllByText(/Hardcoded secret|N\+1 query/).map((n) => n.textContent);
    expect(titles).toEqual(["Hardcoded secret", "N+1 query"]);
  });

  it("keeps a click inside the card from bubbling to the row", () => {
    usePrReviews.mockReturnValue({ isLoading: true, data: undefined });
    const onRowClick = vi.fn();
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <div onClick={onRowClick}>
          <FindingsCell pr={PR} />
        </div>
      </NextIntlClientProvider>,
    );
    const cell = (container.firstChild as Element).firstChild as Element;
    fireEvent.mouseEnter(cell);
    fireEvent.click(screen.getByText("Loading findings…"));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});

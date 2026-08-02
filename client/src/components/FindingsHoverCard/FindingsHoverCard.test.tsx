import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../messages/en/prReview.json";
import { FindingsHoverCard } from "./FindingsHoverCard";

afterEach(cleanup);

function finding(id: string, severity: string, title: string): FindingRecord {
  return {
    id,
    severity: severity as FindingRecord["severity"],
    category: "security",
    title,
    file: `src/${id}.ts`,
    start_line: 1,
    end_line: 1,
    rationale: "why",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  };
}

const FINDINGS = [
  finding("f1", "WARNING", "N+1 query"),
  finding("f2", "CRITICAL", "Hardcoded secret"),
  finding("f3", "CRITICAL", "Exfil path"),
];

function renderCard(props: Partial<React.ComponentProps<typeof FindingsHoverCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <FindingsHoverCard pos={{ left: 0, top: 0 }} findings={FINDINGS} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("FindingsHoverCard", () => {
  it("renders nothing while closed", () => {
    const { baseElement } = renderCard({ pos: null });
    expect(baseElement.textContent).toBe("");
  });

  it("lists every finding worst-first with a header count", () => {
    renderCard();
    expect(screen.getByText("3 findings")).toBeInTheDocument();
    const titles = screen
      .getAllByText(/Hardcoded secret|Exfil path|N\+1 query/)
      .map((n) => n.textContent);
    expect(titles).toEqual(["Hardcoded secret", "Exfil path", "N+1 query"]);
  });

  it("shows only that level's findings when a severity is clicked", () => {
    renderCard();
    fireEvent.click(screen.getByTitle("Warning"));
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    expect(screen.queryByText("Exfil path")).not.toBeInTheDocument();
  });

  it("clears the filter when the active severity is clicked again", () => {
    renderCard();
    fireEvent.click(screen.getByTitle("Warning"));
    fireEvent.click(screen.getByTitle("Warning"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.getByText("N+1 query")).toBeInTheDocument();
  });

  it("switches level rather than combining", () => {
    renderCard();
    fireEvent.click(screen.getByTitle("Warning"));
    fireEvent.click(screen.getByTitle("Critical"));
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
    expect(screen.queryByText("N+1 query")).not.toBeInTheDocument();
  });

  it("keeps the header counts at totals while filtered, and marks the active one", () => {
    renderCard();
    fireEvent.click(screen.getByTitle("Critical"));
    expect(screen.getByTitle("Critical")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTitle("Warning")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByTitle("Critical").textContent).toContain("2");
    expect(screen.getByTitle("Warning").textContent).toContain("1");
    expect(screen.getByText("3 findings")).toBeInTheDocument();
  });

  it("uses a custom label and shows the loading note", () => {
    renderCard({ loading: true, label: "2 findings in this run" });
    expect(screen.getByText("2 findings in this run")).toBeInTheDocument();
    expect(screen.getByText("Loading findings…")).toBeInTheDocument();
  });
});

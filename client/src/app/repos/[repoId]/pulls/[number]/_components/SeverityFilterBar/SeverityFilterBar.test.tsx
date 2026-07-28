import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, Severity } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { SeverityFilterBar } from "./SeverityFilterBar";
import { countBySeverity } from "@/lib/severity";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const COUNTS: Record<Severity, number> = { CRITICAL: 3, WARNING: 5, SUGGESTION: 2 };

function finding(id: string, severity: string, extra: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id,
    severity: severity as Severity,
    category: "security",
    title: `Finding ${id}`,
    file: "src/config.ts",
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
    ...extra,
  };
}

describe("SeverityFilterBar", () => {
  it("renders a chip per non-zero severity, worst first, with resolved labels", () => {
    renderWithIntl(<SeverityFilterBar counts={COUNTS} active={null} onChange={vi.fn()} />);
    const labels = screen.getAllByRole("button").map((b) => b.textContent);
    expect(labels).toEqual(["3 CRITICAL", "5 WARNING", "2 SUGGESTION"]);
  });

  it("omits severities with a zero count", () => {
    renderWithIntl(
      <SeverityFilterBar counts={{ CRITICAL: 0, WARNING: 2, SUGGESTION: 0 }} active={null} onChange={vi.fn()} />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText("2 WARNING")).toBeInTheDocument();
  });

  it("renders nothing when there are no findings at all", () => {
    const { container } = renderWithIntl(
      <SeverityFilterBar counts={{ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 }} active={null} onChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("selects a severity on click", () => {
    const onChange = vi.fn();
    renderWithIntl(<SeverityFilterBar counts={COUNTS} active={null} onChange={onChange} />);
    fireEvent.click(screen.getByText("3 CRITICAL"));
    expect(onChange).toHaveBeenCalledWith("CRITICAL");
  });

  it("clears the filter when the active chip is clicked again", () => {
    const onChange = vi.fn();
    renderWithIntl(<SeverityFilterBar counts={COUNTS} active="CRITICAL" onChange={onChange} />);
    fireEvent.click(screen.getByText("3 CRITICAL"));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe("countBySeverity", () => {
  it("returns all-zeros for no findings", () => {
    expect(countBySeverity([])).toEqual({ CRITICAL: 0, WARNING: 0, SUGGESTION: 0 });
  });

  it("tallies each level, including accepted and dismissed findings", () => {
    const counts = countBySeverity([
      finding("a", "CRITICAL"),
      finding("b", "CRITICAL", { dismissed_at: "2026-01-01T00:00:00Z" }),
      finding("c", "WARNING", { accepted_at: "2026-01-01T00:00:00Z" }),
      finding("d", "SUGGESTION", { confidence: 0.1 }),
    ]);
    expect(counts).toEqual({ CRITICAL: 2, WARNING: 1, SUGGESTION: 1 });
  });

  it("ignores unknown severities", () => {
    expect(countBySeverity([finding("a", "INFO"), finding("b", "WARNING")])).toEqual({
      CRITICAL: 0,
      WARNING: 1,
      SUGGESTION: 0,
    });
  });
});

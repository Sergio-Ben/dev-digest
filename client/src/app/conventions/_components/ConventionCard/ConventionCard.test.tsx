import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";
import { ConventionCard } from "./ConventionCard";

afterEach(cleanup);

const CANDIDATE: ConventionCandidate = {
  id: "c1",
  category: "async-await-then-chains",
  rule: "Always use async/await instead of .then() chains.",
  evidence_path: "src/api/users.ts",
  evidence_snippet: "const user = await db.users.find(id);",
  confidence: 0.92,
  status: "pending",
  skill_id: null,
};

function renderCard(props: Partial<React.ComponentProps<typeof ConventionCard>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionCard candidate={CANDIDATE} {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ConventionCard", () => {
  it("renders the rule, category, evidence location, snippet and confidence", () => {
    renderCard();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
    expect(screen.getByText("async-await-then-chains")).toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts")).toBeInTheDocument();
    expect(screen.getByText(CANDIDATE.evidence_snippet)).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
  });

  it("links the evidence location to GitHub", () => {
    renderCard({
      evidenceHref: "https://github.com/acme/payments-api/blob/main/src/api/users.ts",
    });
    const link = screen.getByRole("link", { name: /src\/api\/users\.ts/ });
    expect(link).toHaveAttribute(
      "href",
      "https://github.com/acme/payments-api/blob/main/src/api/users.ts",
    );
    // Opens away from the app — never navigate the triage list away.
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer");
  });

  it("renders the location as plain text when the repo is unknown", () => {
    renderCard({ evidenceHref: null });
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/api/users.ts")).toBeInTheDocument();
  });

  it("fires onAccept and onReject with the candidate id", () => {
    const onAccept = vi.fn();
    const onReject = vi.fn();
    renderCard({ onAccept, onReject });

    fireEvent.click(screen.getByText("Accepted"));
    expect(onAccept).toHaveBeenCalledWith("c1");

    fireEvent.click(screen.getByText("Reject"));
    expect(onReject).toHaveBeenCalledWith("c1");
  });

  it("commits an edited rule on Enter", () => {
    const onEditRule = vi.fn();
    renderCard({ onEditRule });

    fireEvent.click(screen.getByText(CANDIDATE.rule));
    const input = screen.getByLabelText("Edit rule");
    fireEvent.change(input, { target: { value: "Always await database calls." } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onEditRule).toHaveBeenCalledWith("c1", "Always await database calls.");
  });

  it("reverts on Escape without calling onEditRule", () => {
    const onEditRule = vi.fn();
    renderCard({ onEditRule });

    fireEvent.click(screen.getByText(CANDIDATE.rule));
    const input = screen.getByLabelText("Edit rule");
    fireEvent.change(input, { target: { value: "Something else" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onEditRule).not.toHaveBeenCalled();
    expect(screen.getByText(CANDIDATE.rule)).toBeInTheDocument();
  });

  it("does not fire onEditRule when the text is unchanged", () => {
    const onEditRule = vi.fn();
    renderCard({ onEditRule });

    fireEvent.click(screen.getByText(CANDIDATE.rule));
    fireEvent.keyDown(screen.getByLabelText("Edit rule"), { key: "Enter" });

    expect(onEditRule).not.toHaveBeenCalled();
  });

  it("labels the reject button as Rejected once the candidate is rejected", () => {
    renderCard({ candidate: { ...CANDIDATE, status: "rejected" } });
    expect(screen.getByText("Rejected")).toBeInTheDocument();
  });
});

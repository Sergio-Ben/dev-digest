import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { createTranslator, NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import evalMessages from "../../../../../../../messages/en/eval.json";
import { CaseRow } from "./CaseRow";

/**
 * T15 — cross-cutting a11y/i18n verification for the eval-case row
 * (Capability B, AC-7/8/9). `EvalsTab.test.tsx` already walks the full
 * run/edit/delete interaction flow end-to-end — this file isolates two NFRs
 * called out by the plan that weren't independently asserted there:
 *
 *  - a11y: the pass/fail/never-run status is conveyed by a DIFFERENT icon
 *    per state (not colour alone) — proven by asserting the lucide icon
 *    class differs across the three states, alongside the existing text
 *    label. Run/Edit/Delete stay real, named, focusable <button>s.
 *  - i18n: every visible string in the row is sourced through
 *    `useTranslations("eval")`, not hardcoded — proven with the same
 *    "poisoned messages" technique as `EvalCompare.eval-a11y.test.tsx`: a
 *    hardcoded literal keeps showing real English and an exact-match query
 *    for the poisoned string fails to find it.
 */

afterEach(cleanup);

function poison(node: unknown): unknown {
  if (typeof node === "string") return `⟪${node}⟫`;
  if (Array.isArray(node)) return node.map(poison);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, poison(v)]));
  }
  return node;
}

const poisonedEval = poison(evalMessages) as Record<string, Record<string, string>>;

function renderRow(
  props: Partial<React.ComponentProps<typeof CaseRow>> = {},
  messages: unknown = poisonedEval,
) {
  const evalCase: EvalCase = {
    id: "case-1",
    owner_kind: "agent",
    owner_id: "agent-1",
    name: "stripe-key-leak",
    input_diff: "diff --git a/a.ts b/a.ts",
    input_files: null,
    input_meta: null,
    expected_output: [
      { severity: "CRITICAL", category: "security", title: "t", file: "src/a.ts", start_line: 1, end_line: 2 },
    ],
    notes: null,
  };

  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages } as unknown as AbstractIntlMessages}>
      <CaseRow
        evalCase={evalCase}
        latestRun={null}
        isRunning={false}
        onRun={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

function makeRun(pass: boolean): EvalRunRecord {
  return {
    id: "run-1",
    case_id: "case-1",
    case_name: null,
    ran_at: "2026-08-10T12:00:00.000Z",
    actual_output: [{ file: "src/a.ts" }],
    pass,
    recall: pass ? 1 : 0.5,
    precision: pass ? 1 : 0.5,
    citation_accuracy: pass ? 1 : 0.5,
    duration_ms: 100,
    cost_usd: 0.01,
  };
}

describe("CaseRow — a11y + i18n (T15)", () => {
  it("status carries a DIFFERENT icon per state (never-run/passed/failed), not colour alone", () => {
    const { container: neverRun } = renderRow({ latestRun: null });
    const { container: passed } = renderRow({ latestRun: makeRun(true) });
    const { container: failed } = renderRow({ latestRun: makeRun(false) });

    expect(neverRun.querySelector(".lucide-slash")).toBeTruthy();
    expect(passed.querySelector(".lucide-circle-check-big")).toBeTruthy();
    expect(failed.querySelector(".lucide-circle-x")).toBeTruthy();

    // Each state's icon is distinct from the other two — the signal doesn't
    // collapse to "some icon is present" but genuinely differs by state.
    expect(neverRun.querySelector(".lucide-circle-check-big")).toBeFalsy();
    expect(passed.querySelector(".lucide-slash")).toBeFalsy();
    expect(failed.querySelector(".lucide-circle-check-big")).toBeFalsy();
  });

  it("Run/Edit/Delete are real, named, keyboard-focusable buttons", () => {
    renderRow({ latestRun: makeRun(true) });

    const row = screen.getByRole("listitem");
    const runBtn = within(row).getByRole("button", { name: /run/i });
    const editBtn = within(row).getByRole("button", { name: /edit/i });
    const deleteBtn = within(row).getByRole("button", { name: /delete/i });

    for (const btn of [runBtn, editBtn, deleteBtn]) {
      btn.focus();
      expect(btn).toHaveFocus();
    }
  });

  it("resolves every visible string through eval.evalsTab/eval.caseEditor — no hardcoded English literal survives a message swap", () => {
    renderRow({ latestRun: makeRun(true) });

    const row = screen.getByRole("listitem");
    const evalsTab = poisonedEval.evalsTab!;

    // Status label (as the status icon's accessible name), per-row actions,
    // and the "expected N · got M" summary all render the POISONED text —
    // proof they flow through t(), since a hardcoded JSX literal would be
    // unaffected by the message swap and this exact-match query would fail
    // to find it.
    expect(within(row).getByRole("img", { name: evalsTab.passed })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: evalsTab.run })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: evalsTab.edit })).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: evalsTab.delete })).toBeInTheDocument();

    // `expectedGotSummary` is an ICU plural message — resolve it the same
    // way the component does (via next-intl) rather than re-implementing
    // plural rules with a naive string replace.
    const translate = createTranslator({
      locale: "en",
      messages: { eval: poisonedEval } as unknown as AbstractIntlMessages,
    });
    const expectedGotSummary = translate("eval.caseEditor.expectedGotSummary", { expected: 1, got: 1 });
    expect(within(row).getByText(expectedGotSummary)).toBeInTheDocument();
  });
});

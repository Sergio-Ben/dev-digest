import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider, type AbstractIntlMessages } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import evalMessages from "../../../../../../messages/en/eval.json";
import { EvalCompareModal } from "./EvalCompareModal";

/**
 * T15 — cross-cutting a11y/i18n verification for the compare MODAL. This
 * file deliberately does NOT re-walk the full render/promote flow (already
 * covered end-to-end by `EvalCompareModal.test.tsx`); it isolates the NFRs
 * the plan calls out that weren't independently asserted there:
 *
 *  - a11y: the compare surface renders inside a real `role="dialog"`
 *    (the shared `Modal` primitive), Close/Promote are native `<button>`s
 *    (keyboard-operable by default), and every metric delta's sign is
 *    embedded in the text — never colour alone.
 *  - i18n: every visible string in this view is sourced through
 *    `useTranslations("eval.compare")`, not hardcoded in JSX. Proven with a
 *    "poisoned messages" swap — every string leaf in `eval.compare` is
 *    wrapped in a distinctive marker (⟪…⟫); a hardcoded literal would keep
 *    showing the real English and the marker-based query would fail to
 *    find it, while a properly-translated string renders the marked
 *    version regardless of what the dictionary says.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse<T>(body: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as Response;
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** A delta card's "78% → 82% ▲4pt" text is composed of several differently
 *  styled sibling `<span>`s (old value / arrow / new value / delta chip) so
 *  the design's per-segment sizing/colour can apply — RTL's `getByText`
 *  only matches an element's OWN direct text-node children, not
 *  descendants, so the plain string query can't find the concatenated
 *  result. This matches on normalized `textContent` instead. */
function findByCollapsedText(text: string) {
  return screen.getByText(
    (_, element) => (element?.textContent ?? "").replace(/\s+/g, " ").trim() === text,
  );
}

/** Deep-clones a messages object, wrapping every string leaf in a marker
 *  that survives ICU interpolation (placeholders like `{version}` are left
 *  intact inside the wrapped template, so ICU still substitutes them). */
function poison(node: unknown): unknown {
  if (typeof node === "string") return `⟪${node}⟫`;
  if (Array.isArray(node)) return node.map(poison);
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, poison(v)]));
  }
  return node;
}

const poisonedCompare = poison((evalMessages as { compare: Record<string, unknown> }).compare) as Record<
  string,
  unknown
>;

function renderModal() {
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <NextIntlClientProvider
        locale="en"
        messages={{ eval: { compare: poisonedCompare } } as unknown as AbstractIntlMessages}
      >
        <EvalCompareModal agentId="agent-1" batchA="batch-1" batchB="batch-2" onClose={vi.fn()} />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const batchOlder = {
  batch_id: "batch-1",
  agent_id: "agent-1",
  agent_version: 1,
  ran_at: "2026-08-01T00:00:00.000Z",
  recall: 0.78,
  precision: 0.7,
  citation_accuracy: 0.9,
  traces_passed: 8,
  traces_total: 10,
  cost_usd: 0.12,
};

const batchNewer = {
  batch_id: "batch-2",
  agent_id: "agent-1",
  agent_version: 2,
  ran_at: "2026-08-15T00:00:00.000Z",
  recall: 0.82,
  precision: 0.75,
  citation_accuracy: 0.92,
  traces_passed: 9,
  traces_total: 10,
  cost_usd: 0.15,
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const u = String(url);
      if (u.includes("/eval-compare")) {
        return Promise.resolve(
          jsonResponse({
            older: batchOlder,
            newer: batchNewer,
            deltas: { recall: 0.04, precision: 0.05, citation_accuracy: 0.02 },
            prompt_diff: { added: ["Flag any hardcoded secret."], removed: ["Focus on style only."] },
            trace_count_notice: null,
          }),
        );
      }
      throw new Error(`unexpected fetch: ${u}`);
    }),
  );
}

describe("EvalCompareModal — a11y + i18n (T15)", () => {
  it("renders as a real dialog with keyboard-operable Close/Promote buttons, and delta signs are conveyed in text (not colour alone)", async () => {
    stubFetch();
    renderModal();

    // Real dialog role (the shared Modal primitive), not a hand-rolled overlay.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // AC-32 — every metric delta's sign is embedded IN THE TEXT (▲/▼/–), so
    // the meaning survives even if colour is stripped or unavailable
    // (colour-blindness / high-contrast mode / screen reader). `findByText`
    // (async) waits out the compare data fetch; the second assertion reuses
    // the sync helper now that the data is loaded.
    const recallDelta = await screen.findByText(
      (_, element) => (element?.textContent ?? "").replace(/\s+/g, " ").trim() === "78% → 82% ▲4pt",
    );
    expect(recallDelta).toBeInTheDocument();
    expect(findByCollapsedText("70% → 75% ▲5pt")).toBeInTheDocument(); // precision

    // Close/Promote are native <button>s — focusable and keyboard-operable
    // by browser default, no custom keyboard wiring needed. The Modal
    // primitive's header X icon button shares the "Close" accessible name
    // with the footer text button — the footer one is the LAST DOM match.
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    const closeBtn = closeButtons[closeButtons.length - 1]!;
    closeBtn.focus();
    expect(closeBtn).toHaveFocus();

    const promoteBtn = screen.getByRole("button", { name: /Promote v2/ });
    promoteBtn.focus();
    expect(promoteBtn).toHaveFocus();
  });

  it("resolves every visible string through eval.compare — no hardcoded English literal survives a message swap", async () => {
    stubFetch();
    renderModal();

    await screen.findByRole("dialog");

    // Section chrome — sourced via t(), so it renders the POISONED text.
    // If any of these were a hardcoded JSX literal instead of a t() call,
    // swapping the message dictionary would have no effect and these
    // (exact-match) queries would fail to find them.
    expect(await screen.findByText(poisonedCompare.deltasHeading as string)).toBeInTheDocument();

    const deltas = poisonedCompare.deltas as Record<string, string>;
    expect(screen.getByText(deltas.recall!)).toBeInTheDocument();
    expect(screen.getByText(deltas.precision!)).toBeInTheDocument();
    expect(screen.getByText(deltas.citation!)).toBeInTheDocument();
    expect(screen.getByText(deltas.cost!)).toBeInTheDocument();

    const promptDiff = poisonedCompare.promptDiff as Record<string, string>;
    expect(screen.getByText(promptDiff.title!)).toBeInTheDocument();

    const legend = poisonedCompare.legend as Record<string, string>;
    expect(screen.getByText(legend.old!.replace("{version}", "1"))).toBeInTheDocument();
    expect(screen.getByText(legend.new!.replace("{version}", "2"))).toBeInTheDocument();

    // The footer Close button's label is poisoned (sourced via t()); the
    // Modal primitive's header X icon button keeps its own hardcoded
    // "Close" aria-label — unaffected by this component's i18n namespace.
    const footer = poisonedCompare.footer as Record<string, string>;
    expect(screen.getByRole("button", { name: footer.close! })).toBeInTheDocument();

    // Interpolated key (`Promote v{version}`) still renders wrapped, with
    // the placeholder substituted — proves the marker survives ICU.
    const promote = poisonedCompare.promote as Record<string, string>;
    const expectedButtonName = promote.button!.replace("{version}", "2");
    expect(screen.getByRole("button", { name: expectedButtonName })).toBeInTheDocument();
  });
});

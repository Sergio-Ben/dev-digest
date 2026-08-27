import type { ComponentProps } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import evalMessages from "../../../../../../messages/en/eval.json";
import { EvalCompareModal } from "./EvalCompareModal";

/**
 * Exercises the real `useEvalCompare`/`usePromoteAgentVersion` hooks through
 * a real `QueryClient`, stubbing `global.fetch` (the network boundary
 * `api.ts` calls) rather than mocking the hooks module — mirrors
 * `PrBriefCard.test.tsx`. `@testing-library/user-event` is NOT a client
 * devDependency, so `fireEvent` is used throughout (documented convention,
 * see client/INSIGHTS.md).
 *
 * Unlike the old page-level `EvalCompare`, this component receives an
 * already-selected pair of batch ids as props (the caller — a per-agent
 * detail page's Recent Runs table — owns selection) and renders inside the
 * shared `Modal` primitive, so there is no batch-picker/checkbox UI here.
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

function renderModal(props?: Partial<ComponentProps<typeof EvalCompareModal>>) {
  const onClose = vi.fn();
  const utils = render(
    <QueryClientProvider client={newQueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ eval: evalMessages }}>
        <EvalCompareModal
          agentId="agent-1"
          batchA="batch-1"
          batchB="batch-2"
          onClose={onClose}
          {...props}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
  return { ...utils, onClose };
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

describe("EvalCompareModal", () => {
  it("renders as a dialog with deltas + prompt diff + trace notice, promotes the newer version, and closes on Escape", async () => {
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
              prompt_diff: {
                added: ["Flag any hardcoded secret."],
                removed: ["Focus on style only."],
              },
              trace_count_notice: "trace counts differ: 8 vs 10",
            }),
          );
        }
        if (u.includes("/promote")) {
          return Promise.resolve(
            jsonResponse({
              id: "agent-1",
              name: "Reviewer",
              description: "",
              provider: "anthropic",
              model: "claude",
              system_prompt: "Flag any hardcoded secret.",
              enabled: true,
              version: 2,
              strategy: "single-pass",
              ci_fail_on: "critical",
              repo_intel: true,
              attached_doc_paths: [],
            }),
          );
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { onClose } = renderModal();

    // Renders inside a dialog (the shared Modal primitive).
    expect(await screen.findByRole("dialog")).toBeInTheDocument();

    // Modal title resolves to "Compare runs · v1 → v2" once data loads.
    expect(await screen.findByText("Compare runs · v1 → v2")).toBeInTheDocument();

    // AC-32: metric deltas with sign glyph, older → newer.
    expect(findByCollapsedText("78% → 82% ▲4pt")).toBeInTheDocument();

    // AC-33: prompt diff renders added/removed lines. The design has no
    // visible +/- glyph (only a background highlight), so the sign is
    // carried by an sr-only "Removed:"/"Added:" label instead.
    expect(screen.getByText("Focus on style only.")).toBeInTheDocument();
    expect(screen.getByText("Flag any hardcoded secret.")).toBeInTheDocument();
    expect(screen.getByText(/Removed:/)).toBeInTheDocument();
    expect(screen.getByText(/Added:/)).toBeInTheDocument();

    // AC-35: trace-count-mismatch notice.
    expect(screen.getByText("trace counts differ: 8 vs 10")).toBeInTheDocument();

    // Promote vN: enabled (snapshot present), confirm dialog is i18n, mutates
    // with the NEWER batch's agent_version, and surfaces the new active version.
    const promoteBtn = screen.getByRole("button", { name: /Promote v2/ });
    expect(promoteBtn).toBeEnabled();
    fireEvent.click(promoteBtn);

    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("Make v2 the active version?"),
    );
    expect(await screen.findByText("v2 is now the active version.")).toBeInTheDocument();

    // Footer "Close" and Escape both invoke onClose (keyboard-operable).
    // The Modal primitive's header X icon button shares the "Close"
    // accessible name — the footer text button is the LAST match in DOM order.
    const closeButtons = screen.getAllByRole("button", { name: "Close" });
    fireEvent.click(closeButtons[closeButtons.length - 1]!);
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("shows a 'prompt diff unavailable' note and disables Promote when a snapshot is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const u = String(url);
        if (u.includes("/eval-compare")) {
          return Promise.resolve(
            jsonResponse({
              older: batchOlder,
              newer: { ...batchNewer, traces_total: 12 },
              deltas: { recall: 0.04, precision: 0.05, citation_accuracy: 0.02 },
              prompt_diff: null,
              trace_count_notice: "trace counts differ: 10 vs 12",
            }),
          );
        }
        throw new Error(`unexpected fetch: ${u}`);
      }),
    );

    renderModal();

    // AC-34: unavailable note + Promote disabled for that side.
    expect(await screen.findByText(/Prompt diff unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Promote v2/ })).toBeDisabled();

    // AC-35 notice still shows alongside the unavailable prompt diff.
    expect(screen.getByText("trace counts differ: 10 vs 12")).toBeInTheDocument();
  });
});

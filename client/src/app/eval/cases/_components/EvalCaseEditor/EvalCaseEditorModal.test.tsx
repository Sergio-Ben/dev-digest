import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../messages/en/eval.json";

// Mock the mutation hooks + `useAgent` the modal pulls from the shared hooks
// barrel. Each mutate mock synchronously invokes its `onSuccess` callback
// (mirroring what TanStack Query does once the network call resolves) so the
// test can observe the "save -> run -> footer" chain without a real API.
const { createMutate, updateMutate, runMutate } = vi.hoisted(() => ({
  createMutate: vi.fn((_vars: unknown, opts?: { onSuccess?: (d: unknown) => void }) => {
    opts?.onSuccess?.({ id: "case-1", owner_id: "agent-1" });
  }),
  updateMutate: vi.fn(),
  runMutate: vi.fn((vars: { id: string }, opts?: { onSuccess?: (d: unknown) => void }) => {
    opts?.onSuccess?.({
      run_id: "run-1",
      case_id: vars.id,
      result: {
        recall: 1,
        precision: 1,
        citation_accuracy: 1,
        traces_passed: 1,
        traces_total: 1,
        duration_ms: 420,
        cost_usd: 0.002,
        per_trace: [{ name: "case-1", pass: true, expected: [{}], actual: [{}, {}] }],
      },
    });
  }),
}));

vi.mock("@/lib/hooks", () => ({
  useAgent: () => ({ data: { id: "agent-1", name: "Reviewer" } }),
  useCreateEvalCase: () => ({ mutate: createMutate, isPending: false }),
  useUpdateEvalCase: () => ({ mutate: updateMutate, isPending: false }),
  useRunEvalCase: () => ({ mutate: runMutate, isPending: false }),
}));

// Same relative specifier the component uses, so this intercepts it — the
// "new case" flow (no `caseId`) never calls this, but it's imported eagerly.
vi.mock("../../_hooks/useEvalCase", () => ({
  useEvalCase: () => ({ data: undefined, isLoading: false }),
}));

import { EvalCaseEditorModal } from "./EvalCaseEditorModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderModal(onClose: () => void) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalCaseEditorModal agentId="agent-1" onClose={onClose} />
    </NextIntlClientProvider>,
  );
}

describe("EvalCaseEditorModal", () => {
  it("marks the expected-output JSON invalid and blocks Save (AC-10)", () => {
    renderModal(vi.fn());
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "stripe-key-leak" },
    });

    // Valid by default (empty array) -> Save enabled, indicator says "valid JSON".
    expect(screen.getByText("valid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeEnabled();

    // Malformed JSON -> indicator flips to invalid and Save is blocked.
    const expectedField = screen.getByDisplayValue("[]");
    fireEvent.change(expectedField, { target: { value: "{ not valid json" } });

    expect(screen.getByText("invalid JSON")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
    expect(createMutate).not.toHaveBeenCalled();
  });

  it("runs the case after a successful save when Run on save is on, and shows the result footer (AC-11)", () => {
    renderModal(vi.fn());
    fireEvent.change(screen.getByPlaceholderText("stripe-key-leak"), {
      target: { value: "stripe-key-leak" },
    });

    fireEvent.click(screen.getByRole("switch")); // "Run on save" toggle
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    expect(createMutate).toHaveBeenCalledTimes(1);
    expect(runMutate).toHaveBeenCalledWith(
      { id: "case-1", agentId: "agent-1" },
      expect.anything(),
    );

    // Per-case result footer: pass/fail label + expected/got + duration + cost.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("Last run passed")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding, got 2")).toBeInTheDocument();
    expect(screen.getByText("0.4s")).toBeInTheDocument();
  });

  it("closes on Cancel and inserts a finding skeleton into the expected-output editor", () => {
    const onClose = vi.fn();
    renderModal(onClose);

    fireEvent.click(screen.getByRole("button", { name: /finding skeleton/i }));
    const expectedField = screen.getByDisplayValue(/"severity": "WARNING"/);
    expect(expectedField).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

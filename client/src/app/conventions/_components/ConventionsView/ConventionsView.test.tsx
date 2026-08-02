import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ConventionCandidate, ConventionsPayload } from "@devdigest/shared";
import messages from "../../../../../messages/en/conventions.json";

const extractMutate = vi.fn();
const updateMutate = vi.fn();
let payload: ConventionsPayload | undefined;

vi.mock("@/lib/hooks/conventions", () => ({
  useConventions: () => ({
    data: payload,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useExtractConventions: () => ({ mutate: extractMutate, isPending: false }),
  useUpdateConvention: () => ({ mutate: updateMutate, isPending: false }),
  useConventionSkillDraft: () => ({ data: undefined, isLoading: true, isError: false }),
  useCreateSkillFromConventions: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/lib/hooks/agents", () => ({ useAgents: () => ({ data: [] }) }));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ repoId: "r1", activeRepo: { id: "r1", name: "payments-api" } }),
  useRepoNotFound: () => false,
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { ConventionsView } from "./ConventionsView";

const candidate = (id: string, status: ConventionCandidate["status"]): ConventionCandidate => ({
  id,
  category: "async-await",
  rule: `Rule ${id}`,
  evidence_path: "src/api/users.ts",
  evidence_snippet: "await db.users.find(id);",
  evidence_start_line: 4,
  evidence_end_line: 4,
  confidence: 0.9,
  status,
  skill_id: null,
});

function renderView() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ conventions: messages }}>
      <ConventionsView />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  extractMutate.mockClear();
  updateMutate.mockClear();
  payload = { scan: null, candidates: [] };
});
afterEach(cleanup);

describe("ConventionsView", () => {
  it("shows the empty state and runs extraction from its CTA", () => {
    renderView();
    expect(screen.getByText("No conventions extracted yet")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Run extraction"));
    expect(extractMutate).toHaveBeenCalled();
  });

  it("renders the pre-scan subtitle until a scan exists", () => {
    renderView();
    expect(screen.getByText(/Scan the cloned repo/)).toBeInTheDocument();
  });

  it("summarises the last scan once one exists", () => {
    payload = {
      scan: {
        id: "s1",
        sample_count: 84,
        candidate_count: 2,
        dropped_count: 1,
        model: "gpt-5.4",
        created_at: new Date().toISOString(),
      },
      candidates: [candidate("a", "pending")],
    };
    renderView();
    expect(screen.getByText(/Detected from 84 sample files/)).toBeInTheDocument();
  });

  it("counts accepted candidates and disables Create skill at zero", () => {
    payload = { scan: null, candidates: [candidate("a", "pending"), candidate("b", "pending")] };
    renderView();

    expect(screen.getByText("0 of 2 accepted")).toBeInTheDocument();
    expect(screen.getByText("Create skill").closest("button")).toBeDisabled();
  });

  it("enables Create skill once something is accepted", () => {
    payload = { scan: null, candidates: [candidate("a", "accepted"), candidate("b", "pending")] };
    renderView();

    expect(screen.getByText("1 of 2 accepted")).toBeInTheDocument();
    expect(screen.getByText("Create skill").closest("button")).not.toBeDisabled();
  });

  it("Deselect all returns every accepted candidate to pending", () => {
    payload = { scan: null, candidates: [candidate("a", "accepted"), candidate("b", "pending")] };
    renderView();

    fireEvent.click(screen.getByText("Deselect all"));
    expect(updateMutate).toHaveBeenCalledTimes(1);
    expect(updateMutate).toHaveBeenCalledWith({ id: "a", patch: { status: "pending" } });
  });

  it("clicking Accepted on an already-accepted card toggles it back to pending", () => {
    payload = { scan: null, candidates: [candidate("a", "accepted")] };
    renderView();

    fireEvent.click(screen.getByText("Accepted"));
    expect(updateMutate).toHaveBeenCalledWith({ id: "a", patch: { status: "pending" } });
  });
});

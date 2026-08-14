/* ProjectContextView.test.tsx — hermetic unit tests for the master/detail layout.
   Covers: file-list bucket badges (top-level folder, colour + text label),
   summary footer (count + tokens + time, NO chunk/index wording), auto-selected
   first document rendering markdown, Edit tab textarea + Save mutation with
   success/failure, resync warning, "Used by N agents", clone-absent state. */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, act } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import React from "react";

// ---------------------------------------------------------------------------
// Mock next-intl
// ---------------------------------------------------------------------------

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, params?: Record<string, unknown>) => {
    if (ns !== "projectContext") return key;
    const t: Record<string, string> = {
      "page.title": "Project Context",
      "page.subtitle": "Discovered markdown documents in this repository.",
      "list.heading": "Project Context",
      "panel.selectPrompt": "Select a document to preview or edit.",
      "preview.openPreview": "Preview document",
      "preview.loading": "Loading…",
      "preview.loadError": "Could not load document.",
      "edit.tabPreview": "Preview",
      "edit.tabEdit": "Edit",
      "edit.saveButton": "Save",
      "edit.saving": "Saving…",
      "edit.saved": "Saved",
      "edit.textareaLabel": "Edit document markdown",
      "edit.resyncWarning": "Warning: a repository resync will overwrite unsaved edits.",
      "edit.saveStatus": "Save status",
      "notAvailable.title": "Repository not cloned",
      "notAvailable.body": "Clone this repository first.",
      "empty.title": "No documents discovered",
      "empty.body": "No markdown files found.",
      "error.title": "Could not load project context",
      "error.body": "An error occurred.",
    };
    // Handle interpolated strings
    if (key === "footer.documents") return `${params?.count} documents`;
    if (key === "footer.tokens") return `≈ ${params?.count} tokens total`;
    if (key === "footer.refreshed") return `refreshed ${params?.when}`;
    if (key === "panel.usedByAgents") return `Used by ${params?.count} agents`;
    if (key === "edit.saveError") return `Save failed: ${params?.message}`;
    return t[key] ?? key;
  },
}));

// ---------------------------------------------------------------------------
// Mock @devdigest/ui
// ---------------------------------------------------------------------------

vi.mock("@devdigest/ui", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@devdigest/ui")>();
  return {
    ...orig,
    EmptyState: ({ title, body }: { title: string; body?: string }) => (
      <div data-testid="empty-state">
        <div>{title}</div>
        {body && <div>{body}</div>}
      </div>
    ),
    ErrorState: ({ title, body, onRetry }: { title: string; body?: string; onRetry?: () => void }) => (
      <div data-testid="error-state">
        <div>{title}</div>
        {body && <div>{body}</div>}
        {onRetry && <button onClick={onRetry}>Retry</button>}
      </div>
    ),
    Skeleton: ({ height }: { height?: number }) => <div data-testid="skeleton" style={{ height }} />,
    Button: ({
      children,
      onClick,
      disabled,
      loading,
    }: {
      children?: React.ReactNode;
      onClick?: () => void;
      disabled?: boolean;
      loading?: boolean;
    }) => (
      <button onClick={onClick} disabled={disabled ?? loading} data-loading={loading}>
        {loading ? "Saving…" : children}
      </button>
    ),
    Markdown: ({ children }: { children?: string | null }) => (
      <div data-testid="markdown-content">{children}</div>
    ),
  };
});

// ---------------------------------------------------------------------------
// Mock @/lib/contexts/repoContext
// ---------------------------------------------------------------------------

vi.mock("@/lib/contexts/repoContext", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "owner/repo" } }),
}));

// ---------------------------------------------------------------------------
// Mock hooks
// ---------------------------------------------------------------------------

const mockUseProjectContext = vi.fn();
const mockUseDocument = vi.fn();
const mockUseSaveDocument = vi.fn();

vi.mock("@/lib/hooks/projectContext", () => ({
  useProjectContext: (...args: unknown[]) => mockUseProjectContext(...args),
  useDocument: (...args: unknown[]) => mockUseDocument(...args),
  useSaveDocument: (...args: unknown[]) => mockUseSaveDocument(...args),
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const DOCS = [
  {
    path: "specs/api/schema.md",
    bucket: "specs" as const,
    estimated_tokens: 1200,
    used_by_agents: 2,
  },
  {
    path: "docs/architecture.md",
    bucket: "docs" as const,
    estimated_tokens: 800,
  },
  {
    path: "insights/INSIGHTS.md",
    bucket: "insights" as const,
    estimated_tokens: 450,
  },
];

const SUMMARY = {
  document_count: 3,
  total_estimated_tokens: 2450,
  refreshed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  clone_available: true,
};

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { ProjectContextView } from "./ProjectContextView";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(cleanup);

describe("ProjectContextView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDocument.mockReturnValue({ data: null, isLoading: false, isError: false });
    mockUseSaveDocument.mockReturnValue({ mutate: vi.fn(), isPending: false });
  });

  it("renders bucket badges (top-level folder, text label) and summary footer without chunk/index wording", () => {
    mockUseProjectContext.mockReturnValue({
      data: { documents: DOCS, summary: SUMMARY },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ProjectContextView repoId="repo-1" />);

    // Bucket badges in the file list — folder name as a text label (WCAG: not
    // colour alone). DOM text is the raw lowercase folder; CSS upper-cases.
    expect(screen.getByText("specs")).toBeInTheDocument();
    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.getByText("insights")).toBeInTheDocument();

    // Summary footer — document count and token total
    expect(screen.getByText("3 documents")).toBeInTheDocument();
    expect(screen.getByText("≈ 2,450 tokens total")).toBeInTheDocument();

    // Footer must NOT contain chunk/index wording
    const footerEl = screen.getByLabelText("Document summary");
    expect(footerEl.textContent).not.toMatch(/chunk|index/i);

    // Footer shows refreshed time
    expect(screen.getByText(/refreshed/i)).toBeInTheDocument();
  });

  it("auto-selects the first document and renders its markdown in the panel", () => {
    mockUseProjectContext.mockReturnValue({
      data: { documents: DOCS, summary: SUMMARY },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseDocument.mockReturnValue({
      data: { path: "specs/api/schema.md", text: "# API Schema\n\nSome content." },
      isLoading: false,
      isError: false,
    });

    render(<ProjectContextView repoId="repo-1" />);

    // First document is shown without any click — Preview tab renders markdown.
    expect(screen.getByTestId("markdown-content")).toHaveTextContent("# API Schema");
    // "Used by N agents" for the first doc (used_by_agents: 2)
    expect(screen.getByText("Used by 2 agents")).toBeInTheDocument();
  });

  it("selecting a different document swaps the panel content", () => {
    mockUseProjectContext.mockReturnValue({
      data: { documents: DOCS, summary: SUMMARY },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseDocument.mockReturnValue({
      data: { path: "any", text: "doc body" },
      isLoading: false,
      isError: false,
    });

    render(<ProjectContextView repoId="repo-1" />);

    // Click the second document in the list
    const option = screen.getByRole("option", { name: /architecture\.md/i });
    fireEvent.click(option);

    expect(option).toHaveAttribute("aria-selected", "true");
  });

  it("shows loading skeletons while fetching", () => {
    mockUseProjectContext.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ProjectContextView repoId="repo-1" />);

    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThan(0);
  });

  it("shows error state on fetch failure", () => {
    mockUseProjectContext.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
      refetch: vi.fn(),
    });

    render(<ProjectContextView repoId="repo-1" />);

    expect(screen.getByTestId("error-state")).toBeInTheDocument();
    expect(screen.getByText("Could not load project context")).toBeInTheDocument();
  });

  it("shows not-available state when clone is absent", () => {
    mockUseProjectContext.mockReturnValue({
      data: {
        documents: [],
        summary: { ...SUMMARY, clone_available: false, document_count: 0, total_estimated_tokens: 0 },
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ProjectContextView repoId="repo-1" />);

    expect(screen.getByText("Repository not cloned")).toBeInTheDocument();
    expect(screen.getByText("Clone this repository first.")).toBeInTheDocument();
  });

  it("Edit tab shows textarea (keyboard-accessible) and resync warning", () => {
    mockUseProjectContext.mockReturnValue({
      data: { documents: DOCS, summary: SUMMARY },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseDocument.mockReturnValue({
      data: { path: "specs/api/schema.md", text: "# API Schema" },
      isLoading: false,
      isError: false,
    });

    render(<ProjectContextView repoId="repo-1" />);

    // Switch to Edit tab in the panel
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));

    // Textarea is rendered and keyboard-accessible via aria-label
    const textarea = screen.getByRole("textbox", { name: "Edit document markdown" });
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue("# API Schema");

    // Resync warning is shown
    expect(screen.getByText(/resync.*overwrite/i)).toBeInTheDocument();
  });

  it("Save button calls useSaveDocument mutation and shows success", async () => {
    const mutateMock = vi.fn((_body, opts: { onSuccess?: () => void } = {}) => {
      opts.onSuccess?.();
    });
    mockUseSaveDocument.mockReturnValue({ mutate: mutateMock, isPending: false });
    mockUseProjectContext.mockReturnValue({
      data: { documents: DOCS, summary: SUMMARY },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseDocument.mockReturnValue({
      data: { path: "specs/api/schema.md", text: "original text" },
      isLoading: false,
      isError: false,
    });

    render(<ProjectContextView repoId="repo-1" />);

    // Switch to edit
    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));

    // Click Save
    const saveBtn = screen.getByRole("button", { name: /^Save$/i });
    act(() => { fireEvent.click(saveBtn); });

    // Mutation was called with correct args
    expect(mutateMock).toHaveBeenCalledWith(
      { path: "specs/api/schema.md", text: "original text" },
      expect.any(Object),
    );

    // Success status shown in aria-live region
    await waitFor(() => {
      expect(screen.getByText("Saved")).toBeInTheDocument();
    });
  });

  it("surfaces save failure — does not silently drop", async () => {
    const mutateMock = vi.fn((_body, opts: { onError?: (err: Error) => void } = {}) => {
      opts.onError?.(new Error("Disk full"));
    });
    mockUseSaveDocument.mockReturnValue({ mutate: mutateMock, isPending: false });
    mockUseProjectContext.mockReturnValue({
      data: { documents: DOCS, summary: SUMMARY },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });
    mockUseDocument.mockReturnValue({
      data: { path: "specs/api/schema.md", text: "text" },
      isLoading: false,
      isError: false,
    });

    render(<ProjectContextView repoId="repo-1" />);

    fireEvent.click(screen.getByRole("tab", { name: "Edit" }));
    act(() => { fireEvent.click(screen.getByRole("button", { name: /^Save$/i })); });

    // Error is visible in aria-live region (not silently dropped)
    await waitFor(() => {
      expect(screen.getByText(/Save failed: Disk full/i)).toBeInTheDocument();
    });
  });
});

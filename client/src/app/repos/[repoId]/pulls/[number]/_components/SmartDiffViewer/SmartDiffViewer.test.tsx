import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrFile, SmartDiff } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    // FileCard (reused from the diff-viewer) reads the "shell" namespace for
    // its "no diff text" fallback — provide it alongside "brief" so next-intl
    // doesn't log a MISSING_MESSAGE warning for every rendered file.
    <NextIntlClientProvider locale="en" messages={{ brief: messages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const CORE_PATCH = [
  "@@ -1,2 +1,5 @@",
  " context line",
  "+added line 1",
  "+added line 2",
  "+added line 3",
  "+added line four",
].join("\n");

const WIRING_PATCH = ["@@ -1,1 +1,2 @@", " wiring context", "+wiring added"].join("\n");

const LOCK_PATCH = ["@@ -1,1 +1,2 @@", " lockfile context", "+generated lockfile content"].join("\n");

const FILES: PrFile[] = [
  { path: "src/core.ts", additions: 4, deletions: 0, patch: CORE_PATCH },
  { path: "src/wire.ts", additions: 1, deletions: 0, patch: WIRING_PATCH },
  { path: "pnpm-lock.yaml", additions: 1, deletions: 0, patch: LOCK_PATCH },
];

// Line 5 of CORE_PATCH's new side is "added line four" (see the parsePatch
// trace in SmartDiffViewer.helpers.test.ts-adjacent comments).
const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/core.ts", pseudocode_summary: null, additions: 4, deletions: 0, finding_lines: [5] },
        // Present in the SmartDiff but absent from `files` — must not crash.
        { path: "src/ghost.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] },
      ],
    },
    {
      role: "wiring",
      files: [{ path: "src/wire.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }],
    },
    {
      role: "boilerplate",
      files: [{ path: "pnpm-lock.yaml", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] },
};

describe("SmartDiffViewer", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders groups in the server-sent order (core first) and skips a path absent from `files`", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />);
    const labels = screen.getAllByText(/^(Core logic|Wiring|Boilerplate)$/);
    expect(labels.map((el) => el.textContent)).toEqual(["Core logic", "Wiring", "Boilerplate"]);
    // src/ghost.ts is listed in the SmartDiff but has no matching PrFile.
    expect(screen.queryByText("src/ghost.ts")).not.toBeInTheDocument();
  });

  it("renders a boilerplate file collapsed by default", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />);
    expect(screen.getByText("pnpm-lock.yaml")).toBeInTheDocument();
    expect(screen.queryByText("generated lockfile content")).not.toBeInTheDocument();
  });

  it("starts a file with findings expanded and shows its findings badge", () => {
    renderWithIntl(<SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />);
    expect(screen.getByText("1 finding")).toBeInTheDocument();
    expect(screen.getByText("added line four")).toBeInTheDocument();
  });

  it("clicking the findings badge (re-)expands the file and scrolls to the finding", async () => {
    renderWithIntl(<SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} />);
    // The core file starts open (it has findings) — collapse it manually via
    // its header, like a user who closed it, to exercise the badge's
    // "always end up open" behaviour rather than a no-op.
    fireEvent.click(screen.getByText("src/core.ts"));
    expect(screen.queryByText("added line four")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "1 finding" }));

    await waitFor(() => expect(screen.getByText("added line four")).toBeInTheDocument());
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });

  it("shows the empty state when there are no groups", () => {
    renderWithIntl(
      <SmartDiffViewer
        smartDiff={{ groups: [], split_suggestion: { too_big: false, total_lines: 0, proposed_splits: [] } }}
        files={FILES}
      />,
    );
    expect(screen.getByText("No changes to group yet.")).toBeInTheDocument();
  });
});

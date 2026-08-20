import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BriefResponse } from "@devdigest/shared";
import briefMessages from "../../../../../../../../../messages/en/brief.json";
import prReviewMessages from "../../../../../../../../../messages/en/prReview.json";
import { PrBriefCard } from "./PrBriefCard";
import { ReviewFocusCard } from "./ReviewFocusCard";
import { OverviewTab } from "../OverviewTab";

/**
 * `PrBriefCard` fetches its own data via `useBrief`/`useRegenerateBrief`
 * (client/src/lib/hooks/brief.ts) — there is no data-as-props seam like
 * `BlastRadiusCard`'s. Tests therefore go through the real hooks + a real
 * `QueryClient`, stubbing `global.fetch` (the actual network boundary) —
 * never the hooks module itself — so the loading/error/success wiring is
 * exercised for real (react-testing-library skill: "mock at boundaries only").
 *
 * `@testing-library/user-event` is NOT a client devDependency (confirmed via
 * package.json + every existing client test uses `fireEvent`), so this file
 * uses `fireEvent` to match the actual, verified codebase convention.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse<T>(body: T, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: async () => body,
  } as Response;
}

/** Stub `global.fetch` (the boundary `api.ts` calls) for one test. */
function stubFetch(impl: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => Promise.resolve(impl(url, init))),
  );
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderCard(props: {
  prId?: string | number | null;
  score?: number | null;
  costUsd?: number | null;
  onOpenFileLine?: (file: string, line: number) => void;
}) {
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <PrBriefCard
          prId={props.prId ?? "pr-1"}
          score={props.score ?? null}
          costUsd={props.costUsd ?? null}
          onOpenFileLine={props.onOpenFileLine ?? (() => {})}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function renderReviewFocusCard(props: {
  prId?: string | number | null;
  onOpenFileLine?: (file: string, line: number) => void;
}) {
  return render(
    <QueryClientProvider client={newQueryClient()}>
      <NextIntlClientProvider locale="en" messages={{ brief: briefMessages }}>
        <ReviewFocusCard
          prId={props.prId ?? "pr-1"}
          onOpenFileLine={props.onOpenFileLine ?? (() => {})}
        />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

const BRIEF: BriefResponse = {
  brief: {
    what: "Adds token refresh retry logic.",
    why: "Prevents a transient network blip from logging users out.",
    risk_level: "medium",
    risks: [
      {
        kind: "security",
        title: "Risk A",
        explanation: "Retry loop could hammer the auth endpoint.",
        severity: "high",
        file_refs: ["src/risk-a.ts:5"],
        endpoint_refs: [],
      },
      {
        kind: "reliability",
        title: "Risk B",
        explanation: "No backoff between retries.",
        severity: "medium",
        file_refs: ["src/risk-b.ts:9"],
        endpoint_refs: [],
      },
      {
        kind: "test-coverage",
        title: "Risk C",
        explanation: "No test covers the failure path.",
        severity: "low",
        file_refs: ["src/risk-c.ts:2"],
        endpoint_refs: [],
      },
    ],
    review_focus: [
      {
        file: "src/auth/session.ts",
        line: 42,
        reason: "Core retry logic lives here.",
        endpoint_ref: null,
      },
      {
        file: "src/auth/tokens.ts",
        line: 7,
        reason: "Token refresh helper called from session.ts.",
        endpoint_ref: null,
      },
    ],
  },
  degraded_inputs: [],
  head_sha: "abc123",
  generated_at: "2026-08-18T00:00:00Z",
  provider: "openai",
  model: "gpt-4.1",
  tokens: { header_only: 1300, full_diff: 8200 },
};

describe("PrBriefCard — loaded", () => {
  it("renders the risk level, what/why, and all risks (AC-33..35)", async () => {
    stubFetch((url) => {
      if (url.endsWith("/brief")) return jsonResponse(BRIEF);
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderCard({});

    // Risk level + what/why (AC-33..35)
    expect(await screen.findByText(briefMessages.riskLevel.medium)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.brief.what)).toBeInTheDocument();
    expect(screen.getByText(BRIEF.brief.why)).toBeInTheDocument();

    // Three risk rows (AC-33)
    expect(screen.getByText("Risk A")).toBeInTheDocument();
    expect(screen.getByText("Risk B")).toBeInTheDocument();
    expect(screen.getByText("Risk C")).toBeInTheDocument();
  });

  it("renders the PR score, cost, and the brief's own header-only-vs-full-diff token savings when provided", async () => {
    stubFetch((url) => {
      if (url.endsWith("/brief")) return jsonResponse(BRIEF);
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderCard({ score: 61, costUsd: 0.014 });

    expect(await screen.findByText("61")).toBeInTheDocument();
    expect(screen.getByText(briefMessages.card.prScore)).toBeInTheDocument();
    expect(screen.getByText("$0.014")).toBeInTheDocument();
    // tokens.full_diff=8200, tokens.header_only=1300 → "8k→1.3k"
    expect(screen.getByText("8k→1.3k")).toBeInTheDocument();
  });

  it("omits the score column entirely when score, cost, and tokens are all absent", async () => {
    stubFetch((url) => {
      if (url.endsWith("/brief")) {
        return jsonResponse<BriefResponse>({ ...BRIEF, tokens: null });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderCard({ score: null, costUsd: null });

    await screen.findByText(BRIEF.brief.what);
    expect(screen.queryByText(briefMessages.card.prScore)).toBeNull();
  });
});

describe("ReviewFocusCard — loaded", () => {
  it("renders an ordered, counted list and lets the top row open its file:line (AC-36..38, AC-49 UI half)", async () => {
    stubFetch((url) => {
      if (url.endsWith("/brief")) return jsonResponse(BRIEF);
      throw new Error(`unexpected fetch: ${url}`);
    });
    const onOpenFileLine = vi.fn();
    renderReviewFocusCard({ onOpenFileLine });

    // Heading + count badge (matches review_focus.length)
    expect(await screen.findByText(briefMessages.reviewFocus.heading)).toBeInTheDocument();
    expect(screen.getByText(String(BRIEF.brief.review_focus.length))).toBeInTheDocument();

    // Ordered rows: session.ts (line 42) must render before tokens.ts,
    // matching `review_focus[]`'s own stored order (AC-36).
    const topFocusButton = screen.getByRole("button", {
      name: briefMessages.reviewFocus.openAriaLabel.replace("{file}", "src/auth/session.ts"),
    });
    const secondFocusButton = screen.getByRole("button", {
      name: briefMessages.reviewFocus.openAriaLabel.replace("{file}", "src/auth/tokens.ts"),
    });
    expect(
      topFocusButton.compareDocumentPosition(secondFocusButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Activating the top row opens its file at its own line (AC-37, AC-38, AC-49 UI half)
    fireEvent.click(topFocusButton);
    expect(onOpenFileLine).toHaveBeenCalledWith("src/auth/session.ts", 42);
  });

  it("renders nothing when review_focus is empty", async () => {
    stubFetch((url) => {
      if (url.endsWith("/brief")) {
        return jsonResponse<BriefResponse>({
          ...BRIEF,
          brief: { ...BRIEF.brief, review_focus: [] },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const { container } = renderReviewFocusCard({ prId: "pr-no-focus" });

    await waitFor(() => expect(container.firstChild).toBeNull());
  });
});

describe("PrBriefCard — states", () => {
  it("shows a skeleton while the brief query is in flight (AC-39)", async () => {
    stubFetch(() => new Promise<Response>(() => {})); // never resolves
    const { container } = renderCard({ prId: "pr-loading" });

    await waitFor(() => {
      expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
    });
  });

  it("shows an error message with a Retry action on a failed fetch (AC-39)", async () => {
    // `useBrief` (client/src/lib/hooks/brief.ts) hardcodes its own `retry`
    // option (short-circuits only on a 404), which overrides the test
    // QueryClient's `defaultOptions.queries.retry: false` — per-query options
    // win over defaultOptions. A 404 settles to `isError` immediately instead
    // of exhausting real retries with exponential backoff.
    stubFetch(() => jsonResponse({ error: { message: "Not found" } }, 404));
    renderCard({ prId: "pr-error" });

    expect(await screen.findByText(briefMessages.error)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: briefMessages.retry })).toBeInTheDocument();
  });

  it("shows the no-changed-files copy when degraded_inputs flags it (AC-41)", async () => {
    stubFetch((url) => {
      if (url.endsWith("/brief")) {
        return jsonResponse<BriefResponse>({ ...BRIEF, degraded_inputs: ["no_changed_files"] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderCard({ prId: "pr-no-files" });

    expect(await screen.findByText(briefMessages.noChangedFiles)).toBeInTheDocument();
    expect(screen.getByText(briefMessages.noChangedFilesHint)).toBeInTheDocument();
    // Distinct from the generic "unavailable" state (AC-40 vs AC-41).
    expect(screen.queryByText(briefMessages.unavailable)).toBeNull();
  });

  it("disables Regenerate while the recompute mutation is pending (AC-40)", async () => {
    stubFetch((url, init) => {
      if (init?.method === "POST") return new Promise<Response>(() => {}); // never resolves
      if (url.endsWith("/brief")) return jsonResponse(BRIEF);
      throw new Error(`unexpected fetch: ${url}`);
    });
    renderCard({ prId: "pr-regen" });

    await screen.findByText(BRIEF.brief.what);
    const regenerateButton = screen.getByRole("button", {
      name: briefMessages.regenerateAriaLabel,
    });
    expect(regenerateButton).toBeEnabled();

    fireEvent.click(regenerateButton);

    await waitFor(() => expect(regenerateButton).toBeDisabled());
  });
});

describe("PrBriefCard — empty risks (edge case)", () => {
  it("renders the noRisks copy instead of an empty risks list", async () => {
    stubFetch((url) => {
      if (url.endsWith("/brief")) {
        return jsonResponse<BriefResponse>({
          ...BRIEF,
          brief: { ...BRIEF.brief, risks: [] },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const { container } = renderCard({ prId: "pr-no-risks" });

    expect(await screen.findByText(briefMessages.noRisks)).toBeInTheDocument();
    // No empty `<ul>` region is rendered for risks — the noRisks paragraph
    // replaces it entirely rather than sitting next to an empty list.
    expect(container.querySelectorAll("ul").length).toBe(0);
  });
});

describe("PrBriefCard wired into OverviewTab — DOM order (AC-33)", () => {
  it("renders the PR Brief section before the Intent/Blast row", async () => {
    stubFetch((url) => {
      if (url.endsWith("/brief")) return jsonResponse(BRIEF);
      if (url.endsWith("/blast")) {
        return jsonResponse({ changedSymbols: [], callers: [], impactedEndpoints: [] });
      }
      if (url.endsWith("/intent")) {
        return jsonResponse({ pr_id: "pr-1", intent: "", in_scope: [], out_of_scope: [] });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    render(
      <QueryClientProvider client={newQueryClient()}>
        <NextIntlClientProvider
          locale="en"
          messages={{ brief: briefMessages, prReview: prReviewMessages }}
        >
          <OverviewTab
            prBody={null}
            prId="pr-1"
            changedPaths={[]}
            repoFullName="acme/app"
            headSha="sha1"
            score={null}
            costUsd={null}
            onOpenFileLine={() => {}}
          />
        </NextIntlClientProvider>
      </QueryClientProvider>,
    );

    const briefHeading = await screen.findByText(briefMessages.card.sectionLabel);
    const intentHeading = await screen.findByText(prReviewMessages.intent.sectionLabel);

    expect(
      briefHeading.compareDocumentPosition(intentHeading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

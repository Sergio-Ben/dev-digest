import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadiusResult } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { BlastRadiusCard } from "./BlastRadiusCard";

/**
 * The card's three "no map" states are NOT interchangeable, and confusing them
 * is invisible in a happy-path fixture: a failed request must never render as
 * "no indexed symbols … nothing to trace", which reads to a reviewer as "this
 * change impacts nothing".
 */

afterEach(cleanup);

function renderCard(props: Partial<React.ComponentProps<typeof BlastRadiusCard>>) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <BlastRadiusCard
        blastRadius={undefined}
        isLoading={false}
        changedPaths={new Set<string>()}
        repoFullName="acme/app"
        headSha="abc123"
        onOpenFileLine={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

const EMPTY_DEGRADED: BlastRadiusResult = {
  changedSymbols: [],
  callers: [],
  impactedEndpoints: [],
  degraded: true,
  reason: "no_data",
};

describe("BlastRadiusCard — no-map states", () => {
  it("reports a failed request as an error, not as an empty result", () => {
    renderCard({ isError: true });

    expect(screen.getByText(messages.blastRadius.error)).toBeTruthy();
    // The "nothing to trace" copy is the exact misreading this branch prevents.
    expect(screen.queryByText(messages.blastRadius.emptyBody)).toBeNull();
    expect(screen.queryByText(messages.blastRadius.emptyTitle)).toBeNull();
  });

  it("error wins over a stale cached payload", () => {
    // React Query keeps `data` from the last good fetch while `isError` is set;
    // rendering that map as current would hide the failure entirely.
    renderCard({ isError: true, blastRadius: EMPTY_DEGRADED });

    expect(screen.getByText(messages.blastRadius.error)).toBeTruthy();
  });

  it("still shows the unindexed empty state when the response is degraded", () => {
    renderCard({ blastRadius: EMPTY_DEGRADED });

    expect(screen.getByText(messages.blastRadius.emptyBodyUnindexed)).toBeTruthy();
    expect(screen.queryByText(messages.blastRadius.error)).toBeNull();
  });

  it("shows the plain empty state when nothing failed and nothing was indexed", () => {
    renderCard({
      blastRadius: { changedSymbols: [], callers: [], impactedEndpoints: [] },
    });

    expect(screen.getByText(messages.blastRadius.emptyBody)).toBeTruthy();
  });
});

const CALLED: BlastRadiusResult["changedSymbols"][number] = {
  file: "src/limiter.ts",
  name: "rateLimit",
  kind: "function",
};
const UNCALLED: BlastRadiusResult["changedSymbols"][number] = {
  file: "src/limiter.ts",
  name: "bucketKey",
  kind: "function",
};
const WITH_UNCALLED: BlastRadiusResult = {
  changedSymbols: [CALLED, UNCALLED],
  callers: [
    {
      file: "src/api/webhooks.ts",
      symbol: "handleWebhook",
      viaSymbol: "rateLimit",
      line: 42,
      rank: 3,
    },
  ],
  impactedEndpoints: [],
};

describe("BlastRadiusCard — symbols with no callers", () => {
  it("lists only the called symbols and says how many it hid", () => {
    renderCard({ blastRadius: WITH_UNCALLED });

    expect(screen.getByText("rateLimit")).toBeTruthy();
    expect(screen.queryByText("bucketKey")).toBeNull();
    expect(screen.getByText("1 changed symbol with no callers hidden")).toBeTruthy();
  });

  it("says so outright when no changed symbol has a caller", () => {
    renderCard({
      blastRadius: { ...WITH_UNCALLED, callers: [] },
    });

    expect(
      screen.getByText(
        "None of the 2 changed symbols has callers outside its own file.",
      ),
    ).toBeTruthy();
    // The hidden-count footnote would be redundant next to that sentence.
    expect(screen.queryByText(/hidden/)).toBeNull();
  });

  it("keeps the summary stat on the full change set, not the visible rows", () => {
    renderCard({ blastRadius: WITH_UNCALLED });

    // "2 symbols" stays true of the PR even though one row is hidden — the
    // footnote is what reconciles the two numbers.
    expect(screen.getByText("2")).toBeTruthy();
  });
});

import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PrIntentRecord } from "@devdigest/shared";
import { useRecomputeIntent } from "./intent";

/**
 * `useRecomputeIntent` (client/src/lib/hooks/intent.ts) lives outside
 * `brief.ts`, but its `onSuccess` deliberately invalidates the BRIEF cache
 * too — a recomputed intent can make the composed brief stale — so that
 * cross-hook contract is verified here, next to the brief cache it touches.
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse<T>(body: T): Response {
  return { ok: true, status: 200, statusText: "", json: async () => body } as Response;
}

function newQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("useRecomputeIntent — brief cache invalidation", () => {
  it('invalidates ["brief", prId] when the recompute mutation succeeds', async () => {
    const prId = "pr-1";
    const INTENT: PrIntentRecord = {
      pr_id: prId,
      intent: "Add retry logic to the token refresh flow.",
      in_scope: ["src/auth/session.ts"],
      out_of_scope: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(INTENT)),
    );

    const qc = newQueryClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(() => useRecomputeIntent(prId), { wrapper });

    act(() => {
      result.current.mutate();
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["brief", prId] });
  });
});

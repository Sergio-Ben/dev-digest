/* hooks/smart-diff.ts — React Query hook for the Smart Diff (server-computed
   grouping of a PR's diff into core/wiring/boilerplate + per-file finding
   line anchors). Reflects the LATEST review's findings, so callers that
   invalidate ["reviews", prId] on run completion must also invalidate
   ["smart-diff", prId] — see hooks/reviews.ts (useDeleteRun) and the PR
   detail page's onRunDone. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { SmartDiff } from "@devdigest/shared";

/** Fetch the Smart Diff for a PR (server-grouped diff + finding line anchors). */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
    staleTime: 60 * 1000,
  });
}

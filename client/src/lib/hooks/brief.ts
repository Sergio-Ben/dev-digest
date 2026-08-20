/* hooks/brief.ts — React Query hooks for the PR Brief (what/why/risks/review-focus). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { BriefResponse } from "@devdigest/shared";

/** Fetch the brief for a PR (lazily computed server-side on first access). */
export function useBrief(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<BriefResponse>(`/pulls/${prId}/brief`),
    enabled: prId != null,
    retry: (count, err: unknown) =>
      (err as { status?: number })?.status === 404 ? false : count < 2,
  });
}

/** Force a fresh brief computation for a PR and update the cache on success. */
export function useRegenerateBrief(prId: string | number | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<BriefResponse>(`/pulls/${prId}/brief`, { force: true }),
    onSuccess: (data) => qc.setQueryData(["brief", prId], data),
  });
}

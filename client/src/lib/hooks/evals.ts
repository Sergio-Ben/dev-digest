/* hooks/evals.ts — React Query hooks for the Agent Eval Pipeline (Evals tab,
   case editor, compare view, finding "Turn into eval case" action, and the
   cross-agent Eval Dashboard). Mirrors the shape of hooks/agents.ts and
   hooks/reviews.ts — inline query-key arrays, no central key factory. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalCaseInput,
  EvalRun,
  EvalRunResult,
  EvalRunRecord,
  EvalDashboard,
  EvalBatchRow,
  EvalCompareResult,
  EvalDashboardCross,
} from "@devdigest/shared";

// ---- Cases: list + CRUD (Evals tab, case editor) ----

/** All eval cases owned by an agent, with latest-run status (Evals tab list). */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export interface CreateEvalCaseInput {
  agentId: string;
  input: EvalCaseInput;
}

/** Manually create a new eval case under an agent (case editor "New case"). */
export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: CreateEvalCaseInput) =>
      api.post<EvalCase>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
    },
  });
}

/**
 * Server response for a capture attempt. Idempotent: a repeat capture of an
 * already-captured finding comes back `{ created: false, reason: "exists" }`
 * with the existing case (no duplicate), and an undecided finding comes back
 * `{ created: false, reason: "undecided" }` — neither is an HTTP error, so the
 * caller must branch on this discriminator rather than on success/failure.
 */
export type CaptureCaseResult =
  | { created: true; case: EvalCase }
  | { created: false; reason: "exists"; case: EvalCase }
  | { created: false; reason: "undecided"; message: string };

/**
 * Capture: "Turn into eval case" from a decided finding (Capability A). The
 * finding id is fixed at hook-creation time, mirroring `useDeleteReview(prId)`.
 */
export function useEvalCaseFromFinding(findingId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CaptureCaseResult>(`/findings/${findingId}/eval-case`),
    onSuccess: (data) => {
      // Both `created` and the idempotent `exists` outcome carry the case, so
      // refresh that agent's case list; `undecided` created nothing.
      if ("case" in data) {
        qc.invalidateQueries({ queryKey: ["eval-cases", data.case.owner_id] });
      }
    },
  });
}

export interface UpdateEvalCaseInput {
  id: string;
  patch: Partial<Omit<EvalCaseInput, "owner_kind" | "owner_id">>;
}

/** Edit an eval case (name, frozen diff, expected_output, notes). */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateEvalCaseInput) =>
      api.put<EvalCase>(`/eval-cases/${id}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", data.owner_id] });
      qc.setQueryData(["eval-case", data.id], data);
    },
  });
}

export interface DeleteEvalCaseInput {
  id: string;
  agentId: string;
}

/** Delete an eval case (per-row delete in the Evals tab). */
export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: DeleteEvalCaseInput) =>
      api.del<{ ok: boolean }>(`/eval-cases/${id}`),
    onSuccess: (_d, { id, agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.removeQueries({ queryKey: ["eval-case", id] });
    },
  });
}

// ---- Running cases (single-case "Run"/"Run on save", batch "Run all") ----

export interface RunEvalCaseInput {
  id: string;
  agentId: string;
}

/** Run a single eval case (per-row "Run" + case-editor "Run on save"). */
export function useRunEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: RunEvalCaseInput) =>
      api.post<EvalRunResult>(`/eval-cases/${id}/run`),
    onSuccess: (_d, { id, agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-case", id] });
    },
  });
}

/** Batch run: execute every case for one agent through the real engine
 *  (Evals tab header "Run all"). Response composes the batch aggregate
 *  (`EvalRun`) with the per-case persisted rows (`EvalRunRecord[]`). */
export function useRunAgentEvals(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ batch: EvalRun; runs: EvalRunRecord[] }>(
        `/agents/${agentId}/eval-runs`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard", agentId] });
      qc.invalidateQueries({ queryKey: ["eval-dashboard-cross"] });
    },
  });
}

// ---- Dashboards + compare (Capabilities E/F/G) ----

/** Per-agent eval dashboard: current metrics, delta, trend, run history +
 *  batch history (Evals tab metrics panel). */
export function useEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-dashboard", agentId],
    queryFn: () =>
      api.get<EvalDashboard & { batches: EvalBatchRow[] }>(
        `/agents/${agentId}/eval-dashboard`,
      ),
    enabled: !!agentId,
  });
}

/** Compare two batches for one agent (Capability F compare view). */
export function useEvalCompare(
  agentId: string | null | undefined,
  a: string | null | undefined,
  b: string | null | undefined,
) {
  return useQuery({
    queryKey: ["eval-compare", agentId, a, b],
    queryFn: () =>
      api.get<EvalCompareResult>(
        `/agents/${agentId}/eval-compare?a=${encodeURIComponent(a!)}&b=${encodeURIComponent(b!)}`,
      ),
    enabled: !!agentId && !!a && !!b,
  });
}

/** Cross-agent Eval Dashboard (Capability G) — latest batch per agent +
 *  trend + most-recent-first batch feed. */
export function useEvalDashboardCross() {
  return useQuery({
    queryKey: ["eval-dashboard-cross"],
    queryFn: () => api.get<EvalDashboardCross>("/eval/dashboard"),
  });
}

/** "Run all agents" — bounded batch run across every agent with ≥1 case
 *  (Eval Dashboard header action). */
export function useRunAllAgents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<EvalBatchRow[]>("/eval/run-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-dashboard-cross"] });
      qc.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "eval-dashboard",
      });
    },
  });
}

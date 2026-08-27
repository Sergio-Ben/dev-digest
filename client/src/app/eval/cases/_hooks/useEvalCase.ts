/* useEvalCase — fetch a single eval case by id, used by `EvalCaseEditorModal`
   in edit mode (design-fidelity reconciliation moved the editor from a
   standalone `/eval/cases/:id` route into a modal, but the fetch-by-id need
   is the same — the caller only has a case id, not the full record).
   hooks/evals.ts (T9) only exposes a per-agent list (`useEvalCases`), not a
   single-case getter, even though its mutations already seed the
   `["eval-case", id]` query key (see useUpdateEvalCase's onSuccess). This
   hook fills that gap locally — kept inside the case-editor's owned path
   (`app/eval/cases/**`) rather than touching the shared `hooks/evals.ts`
   file, which belongs to T9. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { EvalCase } from "@devdigest/shared";

export function useEvalCase(id: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", id],
    queryFn: () => api.get<EvalCase>(`/eval-cases/${id}`),
    enabled: !!id,
  });
}

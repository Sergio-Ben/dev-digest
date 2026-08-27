/* hooks/conventions.ts — React Query hooks for the Conventions extractor.

     GET   /repos/:id/conventions              → { scan, candidates }
     POST  /repos/:id/conventions/extract      → re-scan (synchronous, one model call)
     PATCH /conventions/:id                    → accept / reject / edit a rule
     GET   /repos/:id/conventions/skill-draft  → generated draft for the modal
     POST  /repos/:id/conventions/skill        → create the skill

   Imported directly (like hooks/skills.ts), not via the hooks barrel. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionSkillDraft,
  ConventionStatus,
  ConventionsPayload,
  Skill,
  SkillType,
} from "@devdigest/shared";

const key = (repoId: string | null | undefined) => ["conventions", repoId];

export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: key(repoId),
    queryFn: () => api.get<ConventionsPayload>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
  });
}

export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ConventionsPayload>(`/repos/${repoId}/conventions/extract`),
    // The response IS the fresh payload — seed the cache with it so the list
    // updates without a second round-trip, then revalidate.
    onSuccess: (data) => {
      qc.setQueryData(key(repoId), data);
      qc.invalidateQueries({ queryKey: key(repoId) });
    },
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: { rule?: string; category?: string | null; status?: ConventionStatus };
}

export function useUpdateConvention(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key(repoId) });
    },
  });
}

/** Only fetched while the create-skill modal is open. */
export function useConventionSkillDraft(repoId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ["convention-skill-draft", repoId],
    queryFn: () => api.get<ConventionSkillDraft>(`/repos/${repoId}/conventions/skill-draft`),
    enabled: enabled && !!repoId,
  });
}

export interface CreateConventionSkillInput {
  name: string;
  description?: string;
  body: string;
  enabled?: boolean;
  type?: SkillType;
  agent_id?: string;
}

export function useCreateSkillFromConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateConventionSkillInput) =>
      api.post<Skill>(`/repos/${repoId}/conventions/skill`, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key(repoId) });
      qc.invalidateQueries({ queryKey: ["skills"] });
    },
  });
}

export interface ImportSkillFromUrlInput {
  url: string;
  name: string;
  description?: string;
}

/** Import a skill from a public URL (POST /skills/import-url). */
export function useImportSkillFromUrl() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ImportSkillFromUrlInput) =>
      api.post<Skill>("/skills/import-url", input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["skills"] }),
  });
}

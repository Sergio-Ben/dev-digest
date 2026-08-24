/* hooks/projectContext.ts — React Query hooks for Project Context discovery,
   document Preview/Edit, and attach-doc persistence for agents and skills. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  DiscoveredDocument,
  DiscoverySummary,
  DocumentContent,
  SetAttachedDocsBody,
  Agent,
  Skill,
} from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/**
 * List all discovered project-context documents for a repo, plus the summary
 * footer (document_count, total_estimated_tokens, refreshed_at, clone_available).
 */
export function useProjectContext(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-context", repoId],
    queryFn: () =>
      api.get<{ documents: DiscoveredDocument[]; summary: DiscoverySummary }>(
        `/repos/${repoId}/project-context`
      ),
    enabled: !!repoId,
  });
}

// ---------------------------------------------------------------------------
// Document Preview / Edit
// ---------------------------------------------------------------------------

/**
 * Fetch the raw text of a single discovered document.
 * `path` is URL-encoded before being sent as a query param.
 */
export function useDocument(
  repoId: string | null | undefined,
  path: string | null | undefined
) {
  return useQuery({
    queryKey: ["project-document", repoId, path],
    queryFn: () =>
      api.get<DocumentContent>(
        `/repos/${repoId}/project-context/document?path=${encodeURIComponent(path!)}`
      ),
    enabled: !!repoId && !!path,
  });
}

/**
 * Save edited document text back to the clone working tree.
 * On success the cache entry for ['project-document', repoId, path] is updated
 * so subsequent reads reflect the saved text without a re-fetch.
 */
export function useSaveDocument(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { path: string; text: string }) =>
      api.put<DocumentContent>(
        `/repos/${repoId}/project-context/document`,
        body
      ),
    onSuccess: (data) => {
      qc.setQueryData(["project-document", repoId, data.path], data);
    },
  });
}

// ---------------------------------------------------------------------------
// Attach docs — agent
// ---------------------------------------------------------------------------

/**
 * Persist an ordered list of attached doc paths for an agent.
 * Invalidates the agent query so callers see the updated attached_doc_paths.
 */
export function useSetAgentDocs(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetAttachedDocsBody) =>
      api.put<Agent>(`/agents/${agentId}/attached-docs`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent", agentId] });
    },
  });
}

// ---------------------------------------------------------------------------
// Attach docs — skill
// ---------------------------------------------------------------------------

/**
 * Persist an ordered list of attached doc paths for a skill.
 * Invalidates the skill query so callers see the updated attached_doc_paths.
 */
export function useSetSkillDocs(skillId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetAttachedDocsBody) =>
      api.put<Skill>(`/skills/${skillId}/attached-docs`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["skill", skillId] });
    },
  });
}

import { z } from 'zod';

/**
 * Project Context contracts — discovery, document content, and attach/save bodies.
 *
 * Used by the project-context module (server), the agent/skill Context tabs (client),
 * and the run-executor (server) to pass `specs` into reviewPullRequest.
 */

// ---- Bucket (top-level folder badge) ----
// A document's "bucket" is the top-level folder of its repo-relative path
// (e.g. "docs", "server", "client") — or "root" for files at the repo root.
// Free-form because discovery surfaces every `.md` file in the clone, not a
// fixed set of folders.
export const BucketName = z.string();
export type BucketName = z.infer<typeof BucketName>;

// ---- Discovery ----

/** A single discovered markdown document, badged by its top-level folder. */
export const DiscoveredDocument = z.object({
  path: z.string(),
  bucket: BucketName,
  estimated_tokens: z.number().int(),
  /** How many agents currently have this path in their attached_doc_paths. */
  used_by_agents: z.number().int().optional(),
});
export type DiscoveredDocument = z.infer<typeof DiscoveredDocument>;

/** Summary footer returned alongside the document list. */
export const DiscoverySummary = z.object({
  document_count: z.number().int(),
  total_estimated_tokens: z.number().int(),
  /** ISO 8601 timestamp of when discovery ran. */
  refreshed_at: z.string(),
  clone_available: z.boolean(),
});
export type DiscoverySummary = z.infer<typeof DiscoverySummary>;

// ---- Document content ----

/** Path + raw text of a single document (Preview/Edit payload). */
export const DocumentContent = z.object({
  path: z.string(),
  text: z.string(),
});
export type DocumentContent = z.infer<typeof DocumentContent>;

// ---- Request bodies ----

/** Body for PUT /agents/:id/attached-docs and PUT /skills/:id/attached-docs.
 *  `paths` is ordered — array index IS the attach order. */
export const SetAttachedDocsBody = z.object({
  paths: z.array(z.string()),
});
export type SetAttachedDocsBody = z.infer<typeof SetAttachedDocsBody>;

/** Body for PUT /repos/:repoId/project-context/document (edit-in-place). */
export const SaveDocumentBody = z.object({
  path: z.string(),
  text: z.string(),
});
export type SaveDocumentBody = z.infer<typeof SaveDocumentBody>;

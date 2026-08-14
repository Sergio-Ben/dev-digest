/* ContextTab — attach/detach and reorder project-context documents for an agent.
   Mirrors SkillsTab's attach/reorder UX (whole-set replace on save, order = index).

   R-7 repo-selection: agents are workspace-scoped, not repo-scoped. We use
   useRepos() and default to the first repo. If the workspace has no repos,
   the tab shows a prompt. This is the simplest approach the editor gives us
   (the editor has no repo in its own props). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import {
  Badge,
  Skeleton,
  ErrorState,
  Toggle,
  Markdown,
  Drawer,
} from "@devdigest/ui";
import type { DiscoveredDocument } from "@devdigest/shared";
import { useProjectContext, useSetAgentDocs, useDocument } from "@/lib/hooks/projectContext";
import { useRepos } from "@/lib/hooks/repos";

const BUCKET_COLOR: Record<string, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

// ---------------------------------------------------------------------------
// Preview drawer for a single document
// ---------------------------------------------------------------------------

function DocumentPreviewDrawer({
  repoId,
  doc,
  attached,
  onToggle,
  onClose,
}: {
  repoId: string;
  doc: DiscoveredDocument;
  attached: boolean;
  onToggle: (checked: boolean) => void;
  onClose: () => void;
}) {
  const t = useTranslations("agents");
  const { data, isLoading } = useDocument(repoId, doc.path);

  const filename = doc.path.split("/").pop() ?? doc.path;
  const folder = doc.path.includes("/")
    ? doc.path.slice(0, doc.path.lastIndexOf("/"))
    : "";

  return (
    <Drawer
      title={filename}
      subtitle={folder || undefined}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <Badge color={BUCKET_COLOR[doc.bucket] ?? "var(--text-muted)"}>
            {doc.bucket}
          </Badge>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            ~{doc.estimated_tokens.toLocaleString()} {t("context.tokens")}
          </span>
          {doc.used_by_agents !== undefined && (
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
              {t("context.usedByAgents", { count: doc.used_by_agents })}
            </span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>
              {t("context.attach")}
            </span>
            <Toggle
              on={attached}
              size={13}
              onChange={onToggle}
            />
          </div>
        </div>
      }
    >
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Skeleton height={16} />
          <Skeleton height={16} />
          <Skeleton height={16} />
        </div>
      ) : data?.text ? (
        <Markdown>{data.text}</Markdown>
      ) : (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("context.noContent")}
        </p>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// ContextTab
// ---------------------------------------------------------------------------

export function ContextTab({ agentId, attachedDocPaths }: { agentId: string; attachedDocPaths: string[] }) {
  const t = useTranslations("agents");

  // R-7: use first available repo
  const { data: repos, isLoading: reposLoading } = useRepos();
  const repoId = repos && repos.length > 0 ? (repos[0]?.id ?? null) : null;

  const {
    data,
    isLoading: ctxLoading,
    isError: ctxError,
    refetch,
  } = useProjectContext(repoId);

  const setAgentDocs = useSetAgentDocs(agentId);

  const [search, setSearch] = React.useState("");
  const [previewDoc, setPreviewDoc] = React.useState<DiscoveredDocument | null>(null);
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  // Controlled ordered attached paths (local optimistic state)
  const [attachedPaths, setAttachedPaths] = React.useState<string[]>(attachedDocPaths);

  // Keep in sync when agent prop refreshes (e.g., after mutation invalidation)
  React.useEffect(() => {
    setAttachedPaths(attachedDocPaths);
  }, [attachedDocPaths]);

  const isAttached = (path: string) => attachedPaths.includes(path);

  const persist = (newPaths: string[]) => {
    setAttachedPaths(newPaths);
    setAgentDocs.mutate({ paths: newPaths });
  };

  const handleToggle = (path: string, checked: boolean) => {
    const next = checked
      ? [...attachedPaths, path]
      : attachedPaths.filter((p) => p !== path);
    persist(next);
  };

  // Drag reorder — only for attached docs
  const handleDrop = (e: React.DragEvent, targetPath: string) => {
    e.preventDefault();
    const draggedPath = e.dataTransfer.getData("docPath");
    if (!draggedPath || draggedPath === targetPath) return;
    const from = attachedPaths.indexOf(draggedPath);
    const to = attachedPaths.indexOf(targetPath);
    if (from < 0 || to < 0) return;
    const next = [...attachedPaths];
    next.splice(from, 1);
    next.splice(to, 0, draggedPath);
    persist(next);
    setDragOver(null);
  };

  // Keyboard reorder (WCAG alternative to drag)
  const handleMoveUp = (path: string) => {
    const idx = attachedPaths.indexOf(path);
    if (idx <= 0) return;
    const next = [...attachedPaths];
    const tmp = next[idx - 1]!;
    next[idx - 1] = next[idx]!;
    next[idx] = tmp;
    persist(next);
  };

  const handleMoveDown = (path: string) => {
    const idx = attachedPaths.indexOf(path);
    if (idx < 0 || idx >= attachedPaths.length - 1) return;
    const next = [...attachedPaths];
    const tmp = next[idx]!;
    next[idx] = next[idx + 1]!;
    next[idx + 1] = tmp;
    persist(next);
  };

  // Token estimate for attached set
  const allDocs = data?.documents ?? [];
  const attachedDocs = attachedPaths
    .map((p) => allDocs.find((d) => d.path === p))
    .filter(Boolean) as DiscoveredDocument[];
  const tokenEstimate = attachedDocs.reduce((sum, d) => sum + d.estimated_tokens, 0);

  // Sort: attached (in order) first, then unattached alphabetically
  const sorted: DiscoveredDocument[] = React.useMemo(() => {
    if (allDocs.length === 0) return [];
    return [
      ...(attachedPaths
        .map((p) => allDocs.find((d) => d.path === p))
        .filter(Boolean) as DiscoveredDocument[]),
      ...allDocs
        .filter((d) => !isAttached(d.path))
        .sort((a, b) => a.path.localeCompare(b.path)),
    ];
  }, [allDocs, attachedPaths]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtered view — doesn't change attach state (AC-12)
  const filtered = search
    ? sorted.filter((d) => {
        const name = d.path.split("/").pop()?.toLowerCase() ?? "";
        const path = d.path.toLowerCase();
        const q = search.toLowerCase();
        return name.includes(q) || path.includes(q);
      })
    : sorted;

  const isLoading = reposLoading || ctxLoading;

  if (!repoId && !reposLoading) {
    return (
      <div style={{ padding: 28, maxWidth: 720 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {t("context.noRepo")}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 12 }}>
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (ctxError) {
    return <ErrorState body={t("context.loadError")} onRetry={() => refetch()} />;
  }

  return (
    <div style={{ padding: 28, maxWidth: 720 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
          {t("context.title")}
        </h2>
        <span
          aria-live="polite"
          style={{ fontSize: 13, color: "var(--text-muted)" }}
        >
          {t("context.attachedCount", {
            attached: attachedPaths.length,
            total: allDocs.length,
          })}
        </span>
      </div>

      {/* Token estimate + untrusted note (AC-11) */}
      {attachedPaths.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          {t("context.tokenEstimate", { tokens: tokenEstimate.toLocaleString() })}{" "}
          <span style={{ fontStyle: "italic" }}>{t("context.untrustedNote")}</span>
        </p>
      )}

      {/* Search (AC-12) */}
      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t("context.filterPlaceholder")}
        aria-label={t("context.filterPlaceholder")}
        style={{
          width: "100%",
          padding: "6px 10px",
          marginBottom: 14,
          border: "1px solid var(--border)",
          borderRadius: 7,
          background: "var(--bg-elevated)",
          fontSize: 13,
          color: "var(--text-primary)",
          boxSizing: "border-box",
        }}
      />

      {/* Document rows */}
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {filtered.map((doc) => {
          const attached = isAttached(doc.path);
          const filename = doc.path.split("/").pop() ?? doc.path;
          const folder = doc.path.includes("/")
            ? doc.path.slice(0, doc.path.lastIndexOf("/"))
            : "";
          const attachedIdx = attachedPaths.indexOf(doc.path);

          return (
            <div
              key={doc.path}
              draggable={attached}
              onDragStart={(e) => e.dataTransfer.setData("docPath", doc.path)}
              onDragOver={(e) => {
                if (attached) {
                  e.preventDefault();
                  setDragOver(doc.path);
                }
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => handleDrop(e, doc.path)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${dragOver === doc.path ? "var(--accent)" : "var(--border)"}`,
                background: dragOver === doc.path ? "var(--accent-bg)" : "var(--bg-elevated)",
                opacity: attached ? 1 : 0.6,
              }}
            >
              {/* Drag handle (visual) */}
              <span
                aria-hidden="true"
                style={{
                  cursor: attached ? "grab" : "default",
                  color: attached ? "var(--text-muted)" : "transparent",
                  fontSize: 16,
                  userSelect: "none",
                  flexShrink: 0,
                }}
              >
                ≡
              </span>

              {/* Toggle */}
              <div style={{ flexShrink: 0 }}>
                <Toggle
                  on={attached}
                  size={13}
                  onChange={(checked) => handleToggle(doc.path, checked)}
                />
              </div>

              {/* Filename + folder */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    display: "block",
                  }}
                >
                  {filename}
                </span>
                {folder && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      fontFamily: "monospace",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      display: "block",
                    }}
                  >
                    {folder}
                  </span>
                )}
              </div>

              {/* Bucket badge */}
              <Badge color={BUCKET_COLOR[doc.bucket] ?? "var(--text-muted)"}>
                {doc.bucket}
              </Badge>

              {/* Order badge */}
              {attached && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "var(--text-muted)",
                    flexShrink: 0,
                  }}
                >
                  #{attachedIdx + 1}
                </span>
              )}

              {/* Keyboard reorder (WCAG alternative to drag) */}
              {attached && (
                <div style={{ display: "flex", flexDirection: "column", gap: 1, flexShrink: 0 }}>
                  <button
                    type="button"
                    aria-label={t("context.moveUp", { name: filename })}
                    disabled={attachedIdx === 0}
                    onClick={() => handleMoveUp(doc.path)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: attachedIdx === 0 ? "default" : "pointer",
                      color: attachedIdx === 0 ? "var(--text-muted)" : "var(--text-secondary)",
                      padding: "0 2px",
                      lineHeight: 1,
                      fontSize: 10,
                    }}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    aria-label={t("context.moveDown", { name: filename })}
                    disabled={attachedIdx === attachedPaths.length - 1}
                    onClick={() => handleMoveDown(doc.path)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: attachedIdx === attachedPaths.length - 1 ? "default" : "pointer",
                      color: attachedIdx === attachedPaths.length - 1 ? "var(--text-muted)" : "var(--text-secondary)",
                      padding: "0 2px",
                      lineHeight: 1,
                      fontSize: 10,
                    }}
                  >
                    ▼
                  </button>
                </div>
              )}

              {/* Preview button */}
              <button
                type="button"
                aria-label={t("context.preview", { name: filename })}
                onClick={() => setPreviewDoc(doc)}
                style={{
                  background: "none",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  cursor: "pointer",
                  color: "var(--text-secondary)",
                  fontSize: 11,
                  padding: "2px 7px",
                  flexShrink: 0,
                }}
              >
                {t("context.previewBtn")}
              </button>
            </div>
          );
        })}

        {filtered.length === 0 && allDocs.length > 0 && (
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              textAlign: "center",
              padding: 24,
            }}
          >
            {t("context.noMatch")}
          </p>
        )}

        {allDocs.length === 0 && (
          <p
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              textAlign: "center",
              padding: 24,
            }}
          >
            {t("context.empty")}
          </p>
        )}
      </div>

      {/* Preview drawer (AC-13) */}
      {previewDoc && repoId && (
        <DocumentPreviewDrawer
          repoId={repoId}
          doc={previewDoc}
          attached={isAttached(previewDoc.path)}
          onToggle={(checked) => {
            handleToggle(previewDoc.path, checked);
          }}
          onClose={() => setPreviewDoc(null)}
        />
      )}
    </div>
  );
}

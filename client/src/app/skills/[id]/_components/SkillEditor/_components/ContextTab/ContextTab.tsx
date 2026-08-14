/* ContextTab — attach/detach and reorder project-context docs for a skill.
   Any agent that loads this skill will inherit these documents at run time. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Skeleton, ErrorState, Toggle } from "@devdigest/ui";
import type { Skill, DiscoveredDocument } from "@devdigest/shared";
import { useProjectContext } from "@/lib/hooks/projectContext";
import { useSetSkillDocs } from "@/lib/hooks/projectContext";
import { useActiveRepo } from "@/lib/contexts";

// Bucket colour mapping — mirrors the agent ContextTab convention
const BUCKET_COLOR: Record<string, string> = {
  specs: "var(--accent)",
  docs: "var(--ok)",
  insights: "var(--warn)",
};

/** Derive the "serializes as" contribution text for the attached paths. */
function buildContribution(attachedPaths: string[]): string {
  if (attachedPaths.length === 0) return "";
  const lines = ["## Project context", ""];
  for (const p of attachedPaths) {
    lines.push(`- ${p}`);
  }
  return lines.join("\n");
}

export function ContextTab({ skill }: { skill: Skill }) {
  const t = useTranslations("skills");
  const tCtx = useTranslations("projectContext");

  // R-7 choice: skills are workspace-scoped; we discover against the
  // workspace's "active repo" (last-used URL repo > localStorage > first repo).
  const { repoId } = useActiveRepo();

  const {
    data: ctxData,
    isLoading,
    isError,
    refetch,
  } = useProjectContext(repoId);

  const setDocs = useSetSkillDocs(skill.id);

  const [search, setSearch] = React.useState("");
  const [dragOver, setDragOver] = React.useState<string | null>(null);

  // Local attach order mirrors skill.attached_doc_paths; updated optimistically
  const [attachedPaths, setAttachedPaths] = React.useState<string[]>(
    () => skill.attached_doc_paths ?? [],
  );

  // Sync if the skill prop changes (e.g. after mutation invalidates the cache)
  React.useEffect(() => {
    setAttachedPaths(skill.attached_doc_paths ?? []);
  }, [skill.attached_doc_paths]);

  const isAttached = (path: string) => attachedPaths.includes(path);

  const persist = (next: string[]) => {
    setAttachedPaths(next);
    setDocs.mutate({ paths: next });
  };

  const handleToggle = (path: string, checked: boolean) => {
    const next = checked
      ? [...attachedPaths, path]
      : attachedPaths.filter((p) => p !== path);
    persist(next);
  };

  // Drag-and-drop reorder
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

  // Keyboard alternative to drag — move row up/down
  const handleMoveKey = (
    e: React.KeyboardEvent,
    path: string,
  ) => {
    if (!isAttached(path)) return;
    const idx = attachedPaths.indexOf(path);
    if (e.key === "ArrowUp" && idx > 0) {
      e.preventDefault();
      const next = [...attachedPaths];
      [next[idx - 1], next[idx]] = [next[idx]!, next[idx - 1]!];
      persist(next);
    } else if (e.key === "ArrowDown" && idx < attachedPaths.length - 1) {
      e.preventDefault();
      const next = [...attachedPaths];
      [next[idx], next[idx + 1]] = [next[idx + 1]!, next[idx]!];
      persist(next);
    }
  };

  if (!repoId) {
    // No repo available — show not-available state (mirrors R-7 guidance)
    return (
      <div style={{ padding: 28, maxWidth: 720 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {tCtx("notAvailable.body")}
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div
        style={{ padding: 28, display: "flex", flexDirection: "column", gap: 12 }}
      >
        <Skeleton height={48} />
        <Skeleton height={48} />
        <Skeleton height={48} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorState body={tCtx("error.body")} onRetry={() => refetch()} />
    );
  }

  const allDocs: DiscoveredDocument[] = ctxData?.documents ?? [];

  // Filter — by filename/path, never changes attach state (AC-12)
  const filtered = allDocs.filter(
    (d) => !search || d.path.toLowerCase().includes(search.toLowerCase()),
  );

  // Sort: attached (in order) first, then unattached alphabetically
  const sorted = [
    ...(attachedPaths
      .map((p) => allDocs.find((d) => d.path === p))
      .filter(Boolean) as DiscoveredDocument[]),
    ...allDocs
      .filter((d) => !isAttached(d.path))
      .sort((a, b) => a.path.localeCompare(b.path)),
  ].filter(
    (d) => !search || d.path.toLowerCase().includes(search.toLowerCase()),
  );

  // Serializes-as contribution preview (AC-17)
  const contribution = buildContribution(attachedPaths);

  return (
    <div style={{ padding: 28, maxWidth: 720 }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 8,
        }}
      >
        <h2 style={{ fontSize: 15, fontWeight: 700, flex: 1 }}>
          {t("context.title")}
        </h2>
        <span
          aria-live="polite"
          style={{ fontSize: 13, color: "var(--text-muted)" }}
        >
          {t("context.attachedCount", { count: attachedPaths.length })}
        </span>
      </div>

      {/* Inheritance note (AC-15) */}
      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
        {t("context.inheritanceNote")}
      </p>

      {/* Search (AC-12 equivalent) */}
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
      <div
        style={{ display: "flex", flexDirection: "column", gap: 6 }}
        role="list"
        aria-label={t("context.title")}
      >
        {sorted.map((doc) => {
          const attached = isAttached(doc.path);
          const filename = doc.path.split("/").pop() ?? doc.path;
          const folder = doc.path.includes("/")
            ? doc.path.slice(0, doc.path.lastIndexOf("/"))
            : "";

          const borderColor =
            dragOver === doc.path ? "var(--accent)" : "var(--border)";
          const bgColor =
            dragOver === doc.path
              ? "var(--accent-bg)"
              : "var(--bg-elevated)";

          return (
            <div
              key={doc.path}
              role="listitem"
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
              onKeyDown={(e) => handleMoveKey(e, doc.path)}
              tabIndex={attached ? 0 : -1}
              aria-label={
                attached
                  ? t("context.rowAriaAttached", { name: doc.path })
                  : t("context.rowAriaDetached", { name: doc.path })
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${borderColor}`,
                background: bgColor,
                opacity: attached ? 1 : 0.6,
                cursor: attached ? "grab" : "default",
              }}
            >
              {/* Drag handle / keyboard hint */}
              <span
                aria-hidden
                style={{
                  cursor: attached ? "grab" : "default",
                  color: attached ? "var(--text-muted)" : "transparent",
                  fontSize: 16,
                  userSelect: "none",
                  flexShrink: 0,
                }}
                title={attached ? t("context.reorderHint") : undefined}
              >
                ≡
              </span>

              {/* Attach/detach toggle */}
              <div style={{ flexShrink: 0 }}>
                <Toggle
                  on={attached}
                  size={13}
                  onChange={(checked) => handleToggle(doc.path, checked)}
                />
              </div>

              {/* Filename + folder path */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 13,
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {filename}
                </span>
                {folder && (
                  <span
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {folder}
                  </span>
                )}
              </div>

              {/* Bucket badge — colour + text label (WCAG: not colour alone) */}
              <Badge
                color={BUCKET_COLOR[doc.bucket] ?? "var(--text-muted)"}
              >
                {doc.bucket}
              </Badge>

              {/* Order badge for attached */}
              {attached && (
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: "monospace",
                    color: "var(--text-muted)",
                    flexShrink: 0,
                  }}
                >
                  #{attachedPaths.indexOf(doc.path) + 1}
                </span>
              )}
            </div>
          );
        })}
        {sorted.length === 0 && (
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
      </div>

      {/* Serializes-as preview (AC-17) */}
      {attachedPaths.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h3
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "var(--text-secondary)",
              marginBottom: 8,
            }}
          >
            {t("context.serializesAs")}
          </h3>
          <pre
            aria-label={t("context.serializesAs")}
            style={{
              fontSize: 11,
              lineHeight: 1.6,
              fontFamily: "monospace",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "10px 12px",
              overflow: "auto",
              color: "var(--text-secondary)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {contribution}
          </pre>
        </div>
      )}
    </div>
  );
}

/* ProjectContextView — master/detail layout for /repos/:repoId/project-context.
   Left pane: the discovered-document file list + summary footer.
   Right pane: the selected document's Preview/Edit panel. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { EmptyState, ErrorState, Skeleton } from "@devdigest/ui";
import { useActiveRepo } from "@/lib/contexts/repoContext";
import { useProjectContext } from "@/lib/hooks/projectContext";
import { DocumentRow } from "./DocumentRow";
import { DocumentPanel } from "./DocumentPanel";
import type { DiscoveredDocument } from "@devdigest/shared";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compact relative time for the "refreshed {when}" footer label. */
function relativeRefreshed(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const m = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProjectContextView({ repoId }: { repoId: string }) {
  const t = useTranslations("projectContext");
  const { activeRepo } = useActiveRepo();
  const repoName = activeRepo?.full_name ?? repoId;

  const { data, isLoading, isError, error, refetch } = useProjectContext(repoId);

  const documents = data?.documents ?? [];
  const summary = data?.summary;

  // Selected document path. Defaults to the first document; falls back to the
  // first when the current selection disappears (derive, don't store stale).
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);
  const selectedDoc: DiscoveredDocument | null =
    documents.find((d) => d.path === selectedPath) ?? documents[0] ?? null;

  // --- Loading ---
  if (isLoading) {
    return (
      <div style={s.page}>
        <Header title={t("page.title")} subtitle={t("page.subtitle")} />
        <div style={s.loadingStack}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      </div>
    );
  }

  // --- Error ---
  if (isError) {
    return (
      <div style={s.page}>
        <Header title={t("page.title")} />
        <ErrorState
          title={t("error.title")}
          body={error instanceof Error ? error.message : t("error.body")}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }

  // --- Clone not available ---
  if (summary && !summary.clone_available) {
    return (
      <div style={s.page}>
        <Header title={t("page.title")} subtitle={repoName} />
        <EmptyState icon="Folder" title={t("notAvailable.title")} body={t("notAvailable.body")} />
      </div>
    );
  }

  // --- Empty ---
  if (documents.length === 0) {
    return (
      <div style={s.page}>
        <Header title={t("page.title")} subtitle={repoName} />
        <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
      </div>
    );
  }

  return (
    <div style={s.split}>
      {/* Left pane — file list */}
      <aside style={s.listPane} aria-label={t("list.heading")}>
        <div style={s.listHeader}>
          <div style={s.listHeading}>{t("list.heading")}</div>
          <div style={s.listSubtitle}>{repoName}</div>
        </div>

        <div style={s.listScroll} role="listbox" aria-label={t("list.heading")}>
          {documents.map((doc) => (
            <DocumentRow
              key={doc.path}
              doc={doc}
              selected={selectedDoc?.path === doc.path}
              onSelect={() => setSelectedPath(doc.path)}
            />
          ))}
        </div>

        {summary && (
          <div style={s.footer} aria-label="Document summary">
            <span style={s.footerDot}>●</span>
            <span>{t("footer.documents", { count: summary.document_count })}</span>
            <span style={s.footerSep}>·</span>
            <span>{t("footer.tokens", { count: summary.total_estimated_tokens.toLocaleString() })}</span>
            <span style={s.footerSep}>·</span>
            <span>{t("footer.refreshed", { when: relativeRefreshed(summary.refreshed_at) })}</span>
          </div>
        )}
      </aside>

      {/* Right pane — selected document */}
      <section style={s.detailPane}>
        {selectedDoc ? (
          <DocumentPanel key={selectedDoc.path} repoId={repoId} doc={selectedDoc} />
        ) : (
          <div style={s.selectPrompt}>{t("panel.selectPrompt")}</div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div style={s.pageHeader}>
      <h1 style={s.pageTitle}>{title}</h1>
      {subtitle && <p style={s.pageSubtitle}>{subtitle}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = {
  // Full-height split for the master/detail view.
  split: {
    display: "flex",
    height: "100%",
    minHeight: 0,
  } satisfies React.CSSProperties,

  listPane: {
    width: 320,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column" as const,
    borderRight: "1px solid var(--border)",
    minHeight: 0,
  } satisfies React.CSSProperties,

  listHeader: {
    padding: "18px 16px 12px",
    borderBottom: "1px solid var(--border)",
  } satisfies React.CSSProperties,

  listHeading: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "var(--text-muted)",
  } satisfies React.CSSProperties,

  listSubtitle: {
    fontSize: 12,
    color: "var(--text-secondary)",
    marginTop: 4,
    fontFamily: "var(--font-mono, monospace)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  } satisfies React.CSSProperties,

  listScroll: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "8px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 2,
    minHeight: 0,
  } satisfies React.CSSProperties,

  detailPane: {
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  } satisfies React.CSSProperties,

  selectPrompt: {
    display: "grid",
    placeItems: "center",
    height: "100%",
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies React.CSSProperties,

  footer: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap" as const,
    gap: 6,
    padding: "10px 16px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-secondary)",
    background: "var(--bg-surface)",
  } satisfies React.CSSProperties,

  footerDot: {
    fontSize: 8,
    color: "var(--accent)",
  } satisfies React.CSSProperties,

  footerSep: {
    color: "var(--text-muted)",
    userSelect: "none" as const,
  } satisfies React.CSSProperties,

  // Non-split states (loading / error / empty / not-available)
  page: {
    padding: "28px 28px 0",
  } satisfies React.CSSProperties,

  pageHeader: {
    marginBottom: 20,
  } satisfies React.CSSProperties,

  pageTitle: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    margin: 0,
    color: "var(--text-primary)",
  } satisfies React.CSSProperties,

  pageSubtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
    margin: "4px 0 0",
  } satisfies React.CSSProperties,

  loadingStack: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    maxWidth: 360,
  } satisfies React.CSSProperties,
};

/* DocumentPanel — right pane of the Project Context master/detail layout.
   Shows the selected document: a Preview/Edit toggle, a "Used by N agents"
   count, and the rendered markdown (Preview) or a keyboard-operable textarea
   (Edit). Edit shows a resync-clobber warning (AC-34) and a Save button that
   calls useSaveDocument and surfaces failures (never silently drops). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Markdown, Skeleton, Icon } from "@devdigest/ui";
import { useDocument, useSaveDocument } from "@/lib/hooks/projectContext";
import type { DiscoveredDocument } from "@devdigest/shared";

type Tab = "preview" | "edit";

export function DocumentPanel({
  repoId,
  doc,
}: {
  repoId: string;
  doc: DiscoveredDocument;
}) {
  const t = useTranslations("projectContext");

  const [tab, setTab] = React.useState<Tab>("preview");
  // Reset to Preview whenever the selected document changes.
  React.useEffect(() => setTab("preview"), [doc.path]);

  const { data, isLoading, isError } = useDocument(repoId, doc.path);

  // Local edit buffer — initialised from loaded text, then user-editable.
  const [editText, setEditText] = React.useState<string>("");
  React.useEffect(() => {
    if (data?.text != null) setEditText(data.text);
  }, [data?.text]);

  const save = useSaveDocument(repoId);

  type SaveStatus = "idle" | "saving" | "saved" | "error";
  const [saveStatus, setSaveStatus] = React.useState<SaveStatus>("idle");
  const [saveErrorMsg, setSaveErrorMsg] = React.useState<string>("");

  const handleSave = () => {
    setSaveStatus("saving");
    setSaveErrorMsg("");
    save.mutate(
      { path: doc.path, text: editText },
      {
        onSuccess: () => {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2500);
        },
        onError: (err) => {
          setSaveStatus("error");
          setSaveErrorMsg(err instanceof Error ? err.message : String(err));
        },
      },
    );
  };

  const filename = doc.path.includes("/")
    ? doc.path.slice(doc.path.lastIndexOf("/") + 1)
    : doc.path;

  return (
    <div style={s.panel}>
      {/* Header: filename + Preview/Edit toggle + Used by N agents */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <span style={s.filename}>{filename}</span>
          <div style={s.tabBar} role="tablist" aria-label={filename}>
            <button
              role="tab"
              aria-selected={tab === "preview"}
              style={tabStyle(tab === "preview")}
              onClick={() => setTab("preview")}
            >
              {t("edit.tabPreview")}
            </button>
            <button
              role="tab"
              aria-selected={tab === "edit"}
              style={tabStyle(tab === "edit")}
              onClick={() => setTab("edit")}
            >
              {t("edit.tabEdit")}
            </button>
          </div>
        </div>

        {doc.used_by_agents != null && (
          <span style={s.usedBy}>
            <Icon.Cpu size={13} style={{ color: "var(--text-muted)" }} />
            {t("panel.usedByAgents", { count: doc.used_by_agents })}
          </span>
        )}
      </div>

      {/* Body */}
      <div style={s.body}>
        {isLoading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <Skeleton height={20} />
            <Skeleton height={20} />
            <Skeleton height={20} />
          </div>
        ) : isError ? (
          <p style={s.errorText}>{t("preview.loadError")}</p>
        ) : tab === "preview" ? (
          <Markdown>{data?.text}</Markdown>
        ) : (
          <textarea
            aria-label={t("edit.textareaLabel")}
            value={editText}
            onChange={(e) => {
              setEditText(e.target.value);
              if (saveStatus !== "idle") setSaveStatus("idle");
            }}
            style={s.textarea}
            spellCheck={false}
          />
        )}
      </div>

      {/* Edit footer: resync warning + save status + Save */}
      {tab === "edit" && (
        <div style={s.footer}>
          <div style={s.resyncWarning} role="alert">
            {t("edit.resyncWarning")}
          </div>
          <div style={s.footerActions}>
            <span
              aria-live="polite"
              aria-label={t("edit.saveStatus")}
              style={{
                fontSize: 12,
                color: saveStatus === "error" ? "var(--crit)" : "var(--text-secondary)",
              }}
            >
              {saveStatus === "saving"
                ? t("edit.saving")
                : saveStatus === "saved"
                  ? t("edit.saved")
                  : saveStatus === "error"
                    ? t("edit.saveError", { message: saveErrorMsg })
                    : ""}
            </span>
            <Button
              kind="primary"
              size="sm"
              onClick={handleSave}
              loading={saveStatus === "saving"}
              disabled={saveStatus === "saving"}
            >
              {t("edit.saveButton")}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function tabStyle(active: boolean): React.CSSProperties {
  return {
    padding: "4px 12px",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    background: active ? "var(--bg-hover)" : "transparent",
    border: "1px solid",
    borderColor: active ? "var(--border-strong)" : "transparent",
    borderRadius: 5,
    cursor: "pointer",
    transition: "background .1s, color .1s",
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const s = {
  panel: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    minWidth: 0,
  } satisfies React.CSSProperties,

  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    padding: "16px 24px",
    borderBottom: "1px solid var(--border)",
  } satisfies React.CSSProperties,

  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    minWidth: 0,
  } satisfies React.CSSProperties,

  filename: {
    fontSize: 14,
    fontWeight: 600,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-primary)",
    whiteSpace: "nowrap" as const,
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies React.CSSProperties,

  tabBar: {
    display: "flex",
    gap: 4,
    flexShrink: 0,
  } satisfies React.CSSProperties,

  usedBy: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "var(--text-secondary)",
    whiteSpace: "nowrap" as const,
    flexShrink: 0,
  } satisfies React.CSSProperties,

  body: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "24px",
    minHeight: 0,
  } satisfies React.CSSProperties,

  errorText: {
    fontSize: 13,
    color: "var(--crit)",
    margin: 0,
  } satisfies React.CSSProperties,

  textarea: {
    width: "100%",
    minHeight: "100%",
    height: "100%",
    resize: "none" as const,
    padding: "10px 12px",
    fontSize: 13,
    lineHeight: 1.6,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-primary)",
    background: "var(--bg-primary)",
    border: "1px solid var(--border-strong)",
    borderRadius: 6,
    outline: "none",
    boxSizing: "border-box" as const,
  } satisfies React.CSSProperties,

  footer: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
    padding: "12px 24px",
    borderTop: "1px solid var(--border)",
  } satisfies React.CSSProperties,

  resyncWarning: {
    fontSize: 12,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    padding: "6px 10px",
    borderRadius: 5,
    lineHeight: 1.4,
  } satisfies React.CSSProperties,

  footerActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 10,
  } satisfies React.CSSProperties,
};

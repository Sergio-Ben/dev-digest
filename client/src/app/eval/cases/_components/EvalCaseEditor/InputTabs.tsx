"use client";

import { useTranslations } from "next-intl";
import { Tabs, FormField, Textarea, TextInput } from "@devdigest/ui";
import { DiffEditor } from "./DiffEditor";

export type InputTabKey = "diff" | "files" | "prMeta";

/** Diff / Files / PR-meta tabs — display/edit the case's raw input (T11). */
export function InputTabs({
  tab,
  onTab,
  diff,
  onDiff,
  files,
  onFiles,
  title,
  onTitle,
  body,
  onBody,
}: {
  tab: InputTabKey;
  onTab: (tab: InputTabKey) => void;
  diff: string;
  onDiff: (v: string) => void;
  files: string;
  onFiles: (v: string) => void;
  title: string;
  onTitle: (v: string) => void;
  body: string;
  onBody: (v: string) => void;
}) {
  const t = useTranslations("eval");
  return (
    <FormField label={t("caseEditor.inputLabel")}>
      <Tabs
        pad="0"
        value={tab}
        onChange={(k) => onTab(k as InputTabKey)}
        tabs={[
          { key: "diff", label: t("caseEditor.tabs.diff") },
          { key: "files", label: t("caseEditor.tabs.files") },
          { key: "prMeta", label: t("caseEditor.tabs.prMeta") },
        ]}
      />
      <div style={{ marginTop: 16 }}>
        {tab === "diff" && (
          <DiffEditor value={diff} onChange={onDiff} placeholder={t("caseEditor.diffPlaceholder")} />
        )}
        {tab === "files" && (
          <Textarea
            mono
            rows={12}
            value={files}
            onChange={onFiles}
            placeholder={t("caseEditor.filesPlaceholder")}
          />
        )}
        {tab === "prMeta" && (
          <>
            <FormField label={t("caseEditor.titleLabel")}>
              <TextInput value={title} onChange={onTitle} placeholder={t("caseEditor.titlePlaceholder")} />
            </FormField>
            <FormField label={t("caseEditor.bodyLabel")}>
              <Textarea
                rows={6}
                value={body}
                onChange={onBody}
                placeholder={t("caseEditor.bodyPlaceholder")}
              />
            </FormField>
          </>
        )}
      </div>
    </FormField>
  );
}

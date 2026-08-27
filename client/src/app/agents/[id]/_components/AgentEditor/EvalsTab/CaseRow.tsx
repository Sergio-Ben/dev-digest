/* CaseRow — one eval case: pass/fail/never-run status icon (AC-7/8), case
   name, "expected N · got M" summary (or "never run" in its place, AC-8), a
   lead severity · category tag (or "empty []" for a must-not-flag case), and
   per-row run/edit/delete icon actions (AC-9). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Badge, Button, Icon, SEV } from "@devdigest/ui";
import type { EvalCase, EvalRunRecord } from "@devdigest/shared";
import { actualCount, caseStatus, expectedCount, firstExpected } from "./helpers";

const STATUS_ICON = { "never-run": Icon.Slash, passed: Icon.CheckCircle, failed: Icon.XCircle } as const;
const STATUS_COLOR = {
  "never-run": "var(--text-muted)",
  passed: "var(--ok)",
  failed: "var(--crit)",
} as const;

export function CaseRow({
  evalCase,
  latestRun,
  isRunning,
  onRun,
  onEdit,
  onDelete,
}: {
  evalCase: EvalCase;
  latestRun: EvalRunRecord | null;
  isRunning: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useTranslations("eval");
  const status = caseStatus(latestRun);
  const tag = firstExpected(evalCase.expected_output);
  const isEmptyCase = expectedCount(evalCase.expected_output) === 0;

  // AC-7/8: status is conveyed by a DIFFERENT icon shape per state (not
  // colour alone) plus an accessible-name label for screen readers.
  const StatusIcon = STATUS_ICON[status];
  const statusLabel = t(`evalsTab.${status === "never-run" ? "neverRun" : status}`);

  return (
    <div
      role="listitem"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid var(--border)",
        background: "var(--bg-elevated)",
      }}
    >
      <span role="img" aria-label={statusLabel} style={{ flexShrink: 0, display: "inline-flex", color: STATUS_COLOR[status] }}>
        <StatusIcon size={18} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontWeight: 600, fontSize: 13 }}>
          {evalCase.name}
        </div>

        {/* AC-8: a never-run case shows the "never run" text in place of any
            metric numbers — never both. */}
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }} className={status === "never-run" ? undefined : "tnum"}>
          {status === "never-run"
            ? t("evalsTab.neverRun")
            : t("caseEditor.expectedGotSummary", {
                expected: expectedCount(evalCase.expected_output),
                got: actualCount(latestRun?.actual_output),
              })}
        </div>
      </div>

      {/* Lead severity · category tag (AC-7), or "empty []" for a
          must-not-flag case (expects zero findings). Category is free text
          on the wire, so it's folded into the badge label rather than the
          fixed-enum CategoryTag. */}
      {tag ? (
        <Badge color={SEV[tag.severity].c} bg={SEV[tag.severity].bg} style={{ flexShrink: 0 }}>
          {SEV[tag.severity].label.toUpperCase()} · {tag.category}
        </Badge>
      ) : (
        isEmptyCase && (
          <Badge color="var(--text-muted)" bg="var(--bg-hover)" mono style={{ flexShrink: 0 }}>
            {t("evalsTab.emptyTag")}
          </Badge>
        )
      )}

      <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
        <Button kind="tertiary" size="sm" icon="Play" loading={isRunning} onClick={onRun} aria-label={isRunning ? t("evalsTab.running") : t("evalsTab.run")} />
        <Button kind="tertiary" size="sm" icon="Edit" onClick={onEdit} aria-label={t("evalsTab.edit")} />
        <Button kind="danger" size="sm" icon="Trash" onClick={onDelete} aria-label={t("evalsTab.delete")} />
      </div>
    </div>
  );
}

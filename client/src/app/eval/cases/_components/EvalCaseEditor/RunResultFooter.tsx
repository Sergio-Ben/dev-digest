"use client";

import { useTranslations } from "next-intl";
import type { EvalRunResult } from "@devdigest/shared";
import { Icon } from "@devdigest/ui";
import { formatCost } from "@/lib/cost";
import { countFindings } from "./helpers";

/**
 * Per-case run result footer (AC-11): "Last run … · expected N · got M ·
 * <ms> · $<cost>". Shown after "Run on save" (or the manual "Run case"
 * button) completes. Pass/fail is never colour-only — an icon AND a text
 * label both change.
 */
export function RunResultFooter({ result }: { result: EvalRunResult | null }) {
  const t = useTranslations("eval");
  if (!result) return null;

  const trace = result.result.per_trace[0];
  const pass = trace?.pass ?? false;
  const expected = trace ? countFindings(trace.expected) : 0;
  const got = trace ? countFindings(trace.actual) : 0;
  const durationS = (result.result.duration_ms / 1000).toFixed(1);
  const cost = formatCost(result.result.cost_usd);

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 14px",
        borderRadius: 7,
        border: `1px solid ${pass ? "var(--ok)" : "var(--crit)"}`,
        background: pass ? "var(--ok-bg)" : "var(--crit-bg)",
        fontSize: 13,
        color: "var(--text-secondary)",
      }}
    >
      {pass ? (
        <Icon.CheckCircle size={15} style={{ color: "var(--ok)" }} />
      ) : (
        <Icon.XCircle size={15} style={{ color: "var(--crit)" }} />
      )}
      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>
        {pass ? t("caseEditor.lastRunPassed") : t("caseEditor.lastRunFailed")}
      </span>
      <span>·</span>
      <span>{t("caseEditor.expectedGotSummary", { expected, got })}</span>
      <span>·</span>
      <span className="tnum">{durationS}s</span>
      <span>·</span>
      <span className="tnum">{cost}</span>
    </div>
  );
}

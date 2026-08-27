/* RunHistoryTable — per-agent run-history list (AC-31): every case run,
   most-recent-first, with its metrics + pass/fail as plain text (not colour
   alone) and cost via the shared `formatCost` (distinguishes "no cost data"
   from a genuine $0). Mirrors the shape of the cross-agent
   EvalDashboardView's RecentRunsTable, minus the agent/version columns that
   only make sense across agents. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalRunRecord } from "@devdigest/shared";
import { formatCost } from "@/lib/cost";
import { formatPct, sortRunsDesc } from "./helpers";

export function RunHistoryTable({ runs }: { runs: EvalRunRecord[] | undefined }) {
  const t = useTranslations("eval");
  const rows = sortRunsDesc(runs);

  if (rows.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</p>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 11.5 }}>
          <Th>{t("dashboard.table.ranAt")}</Th>
          <Th>{t("dashboard.table.recall")}</Th>
          <Th>{t("dashboard.table.precision")}</Th>
          <Th>{t("dashboard.table.citation")}</Th>
          <Th>{t("dashboard.table.pass")}</Th>
          <Th>{t("dashboard.table.cost")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((run) => (
          <tr key={run.id} style={{ borderTop: "1px solid var(--border)" }}>
            <Td>{new Date(run.ran_at).toLocaleString()}</Td>
            <Td className="tnum">{formatPct(run.recall)}</Td>
            <Td className="tnum">{formatPct(run.precision)}</Td>
            <Td className="tnum">{formatPct(run.citation_accuracy)}</Td>
            <Td>{run.pass == null ? "—" : t(run.pass ? "dashboard.pass" : "dashboard.fail")}</Td>
            <Td className="tnum">{formatCost(run.cost_usd)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ padding: "6px 10px", fontWeight: 600 }}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <td className={className} style={{ padding: "8px 10px" }}>
      {children}
    </td>
  );
}

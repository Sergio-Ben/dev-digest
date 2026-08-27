/* RecentRunsTable — "recent eval runs · all agents" list, most-recent-first
   (AC-37): agent name, timestamp, version, and recall/precision/citation shown
   as colour-coded progress meters (recall=blue, precision=green, citation=amber)
   with the percentage beside each bar, plus the pass count. Matches the design. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { EvalBatchRow } from "@devdigest/shared";
import { formatPct, METRIC_COLORS, sortByRanAtDesc } from "../helpers";

export function RecentRunsTable({
  batches,
  agentNames,
}: {
  batches: EvalBatchRow[];
  agentNames: Record<string, string>;
}) {
  const t = useTranslations("eval");
  const rows = sortByRanAtDesc(batches);

  if (rows.length === 0) {
    return <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</p>;
  }

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 11 }}>
          <Th>{t("dashboard.table.agent")}</Th>
          <Th>{t("dashboard.table.ranAt")}</Th>
          <Th>{t("dashboard.table.version")}</Th>
          <Th wide>{t("dashboard.table.recall")}</Th>
          <Th wide>{t("dashboard.table.precision")}</Th>
          <Th wide>{t("dashboard.table.citation")}</Th>
          <Th>{t("dashboard.table.pass")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((batch) => (
          <tr key={batch.batch_id} style={{ borderTop: "1px solid var(--border)" }}>
            <Td style={{ fontWeight: 600 }}>{agentNames[batch.agent_id] ?? batch.agent_id}</Td>
            <Td style={{ color: "var(--text-muted)" }}>{new Date(batch.ran_at).toLocaleString()}</Td>
            <Td style={{ color: "var(--accent)", fontWeight: 600 }}>v{batch.agent_version}</Td>
            <Td>
              <Meter value={batch.recall} color={METRIC_COLORS.recall} label={t("dashboard.table.recall")} />
            </Td>
            <Td>
              <Meter value={batch.precision} color={METRIC_COLORS.precision} label={t("dashboard.table.precision")} />
            </Td>
            <Td>
              <Meter
                value={batch.citation_accuracy}
                color={METRIC_COLORS.citation}
                label={t("dashboard.table.citation")}
              />
            </Td>
            <Td className="tnum" style={{ fontWeight: 700 }}>
              {batch.traces_passed}/{batch.traces_total}
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A compact horizontal meter (coloured bar + percentage) for one metric cell. */
function Meter({ value, color, label }: { value: number; color: string; label: string }) {
  const pct = formatPct(value);
  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}
      role="meter"
      aria-label={`${label} ${pct}`}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div style={{ flex: 1, height: 6, background: "var(--bg-hover)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: pct, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span className="tnum" style={{ fontSize: 12, color: "var(--text-secondary)", minWidth: 32, textAlign: "right" }}>
        {pct}
      </span>
    </div>
  );
}

function Th({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  return <th style={{ padding: "6px 12px", fontWeight: 600, width: wide ? "18%" : undefined }}>{children}</th>;
}

function Td({
  children,
  className,
  style,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <td className={className} style={{ padding: "9px 12px", ...style }}>
      {children}
    </td>
  );
}

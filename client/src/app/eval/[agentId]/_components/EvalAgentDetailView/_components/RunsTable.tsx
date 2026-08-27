/* RunsTable — "Recent runs" list on the per-agent detail page: one row per
   batch (agent-version execution), a checkbox per row capped at exactly two
   selections (see helpers.toggleBatchSelection), and a "Compare" action that
   only enables once exactly two rows are checked. Mirrors the columns +
   Th/Td building blocks of EvalDashboardView's RecentRunsTable and EvalsTab's
   RunHistoryTable, plus the checkbox + VERSION column this view needs for
   the compare flow. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, Checkbox, Icon, ProgressBar } from "@devdigest/ui";
import type { EvalBatchRow } from "@devdigest/shared";
import { formatCost } from "@/lib/cost";
import { formatPct, formatRanAt, sortBatchesDesc } from "../helpers";

const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0,0,0,0)",
  whiteSpace: "nowrap",
  border: 0,
};

export function RunsTable({
  batches,
  selected,
  onToggle,
  onCompare,
}: {
  batches: EvalBatchRow[];
  selected: string[];
  onToggle: (batchId: string) => void;
  onCompare: () => void;
}) {
  const t = useTranslations("eval");
  const rows = sortBatchesDesc(batches);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <Icon.History size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        <h3
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            margin: 0,
          }}
        >
          {t("dashboard.recentRuns")}
        </h3>
        {selected.length > 0 && (
          <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>
            {t("detail.selectedCount", { count: selected.length })}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Button kind="primary" size="sm" icon="Workflow" disabled={selected.length !== 2} onClick={onCompare}>
          {t("detail.compare")}
        </Button>
      </div>

      {rows.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{t("dashboard.noRuns")}</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-muted)", fontSize: 11.5 }}>
              <Th style={{ width: 32 }}>
                <span style={visuallyHidden}>{t("detail.selectColumn")}</span>
              </Th>
              <Th>{t("dashboard.table.ranAt")}</Th>
              <Th>{t("dashboard.table.version")}</Th>
              <Th>{t("dashboard.table.recall")}</Th>
              <Th>{t("dashboard.table.precision")}</Th>
              <Th>{t("dashboard.table.citation")}</Th>
              <Th>{t("dashboard.table.pass")}</Th>
              <Th>{t("dashboard.table.cost")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((batch) => {
              const checked = selected.includes(batch.batch_id);
              const ranAt = formatRanAt(batch.ran_at);
              return (
                <tr key={batch.batch_id} style={{ borderTop: "1px solid var(--border)" }}>
                  <Td>
                    <Checkbox
                      checked={checked}
                      onChange={() => onToggle(batch.batch_id)}
                      label={<span style={visuallyHidden}>{t("detail.selectRun", { ranAt })}</span>}
                    />
                  </Td>
                  <Td className="mono tnum" style={{ color: "var(--text-secondary)" }}>
                    {ranAt}
                  </Td>
                  <Td>
                    <span className="mono" style={{ color: "var(--accent)" }}>
                      v{batch.agent_version}
                    </span>
                  </Td>
                  <Td>
                    <MetricCell value={batch.recall} color="var(--accent)" />
                  </Td>
                  <Td>
                    <MetricCell value={batch.precision} color="var(--ok)" />
                  </Td>
                  <Td>
                    <MetricCell value={batch.citation_accuracy} color="var(--warn)" />
                  </Td>
                  <Td className="tnum" style={{ fontWeight: 700 }}>
                    {batch.traces_passed}/{batch.traces_total}
                  </Td>
                  <Td className="tnum" style={{ color: "var(--text-muted)" }}>
                    {formatCost(batch.cost_usd)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** A metric cell: a short fixed-width fill bar (0-100%, no visible track —
 *  the approved design draws only the coloured segment, letting the row's
 *  own background stand in for the remainder) followed by the percent
 *  value, matching the RECALL/PRECISION/CITATION columns pixel-for-pixel. */
function MetricCell({ value, color }: { value: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div style={{ width: 64 }}>
        <ProgressBar value={value * 100} color={color} bg="transparent" height={5} />
      </div>
      <span className="tnum">{formatPct(value)}</span>
    </div>
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        padding: "6px 10px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        ...style,
      }}
    >
      {children}
    </th>
  );
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
    <td className={className} style={{ padding: "8px 10px", ...style }}>
      {children}
    </td>
  );
}

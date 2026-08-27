/* AgentSummaryCard — one full-width row per agent on the cross-agent Eval
   Dashboard (AC-36), matching the design: a rounded agent icon, the name +
   model badge and a "last run vN · date · N/M pass" subline on the left; a
   recall trend sparkline and three colour-coded metric columns
   (recall=blue, precision=green, citation=amber) plus a right-chevron on the
   right. An agent with no batches renders the AC-38 "no runs yet" state
   instead of blank or fabricated metrics. The whole row links to that agent's
   per-agent eval detail page (`/eval/{agentId}`). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Icon, Sparkline } from "@devdigest/ui";
import type { EvalAgentSummary } from "@devdigest/shared";
import { formatPct, METRIC_COLORS } from "../helpers";

export function AgentSummaryCard({ agent }: { agent: EvalAgentSummary }) {
  const t = useTranslations("eval");
  const { latest, trend } = agent;

  return (
    <Link
      href={`/eval/${agent.agent_id}`}
      aria-label={t("dashboard.viewAgentDetail", { name: agent.name })}
      style={{
        background: "var(--bg-elevated)",
        border: "1px solid var(--border)",
        borderRadius: 10,
        padding: "14px 18px",
        display: "flex",
        alignItems: "center",
        gap: 16,
        color: "inherit",
        textDecoration: "none",
      }}
    >
      {/* Left: icon + name/model + last-run subline */}
      <div
        style={{
          width: 38,
          height: 38,
          flexShrink: 0,
          borderRadius: 8,
          background: "var(--bg-hover)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--accent)",
        }}
      >
        <Icon.Cpu size={18} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>{agent.name}</span>
          <Badge color="var(--text-secondary)">{agent.model}</Badge>
        </div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 3 }}>
          {latest
            ? t("dashboard.lastRunSummary", {
                version: latest.agent_version,
                ranAt: new Date(latest.ran_at).toLocaleString(),
                passed: latest.traces_passed,
                total: latest.traces_total,
              })
            : t("dashboard.noRuns")}
        </div>
      </div>

      {/* Right: sparkline + three metric columns + chevron */}
      {latest && (
        <div style={{ display: "flex", alignItems: "center", gap: 28, flexShrink: 0 }}>
          {trend.length > 1 && (
            <div
              title={t("dashboard.metricTrend")}
              aria-label={t("dashboard.metricTrend")}
              style={{ display: "flex", alignItems: "center" }}
            >
              <Sparkline data={trend.map((p) => p.recall)} color={METRIC_COLORS.recall} w={72} h={26} />
            </div>
          )}
          <Metric label={t("dashboard.metrics.recall")} value={latest.recall} color={METRIC_COLORS.recall} />
          <Metric label={t("dashboard.metrics.prec")} value={latest.precision} color={METRIC_COLORS.precision} />
          <Metric
            label={t("dashboard.metrics.cite")}
            value={latest.citation_accuracy}
            color={METRIC_COLORS.citation}
          />
        </div>
      )}

      <Icon.ChevronRight size={18} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
    </Link>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2, minWidth: 48 }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, color: "var(--text-muted)", letterSpacing: "0.06em" }}>
        {label}
      </span>
      <span className="tnum" style={{ fontSize: 17, fontWeight: 700, color }}>
        {formatPct(value)}
      </span>
    </div>
  );
}

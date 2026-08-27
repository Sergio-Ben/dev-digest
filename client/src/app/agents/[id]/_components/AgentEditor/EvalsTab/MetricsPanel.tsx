/* MetricsPanel — batch-level metrics with signed deltas vs. the previous
   batch (AC-30), a metric-trend chart across versions, and the run-history
   list (AC-31). Best-effort: on a dashboard load error this renders a quiet
   inline note rather than an intrusive/blocking error box, and renders
   nothing while there are no cases yet (the tab's empty state already
   covers that). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { LineChart, MetricCard, SectionLabel, Skeleton } from "@devdigest/ui";
import type { EvalBatchRow, EvalDashboard } from "@devdigest/shared";
import { RunHistoryTable } from "./RunHistoryTable";
import { tracesPassedDelta } from "./helpers";

export function MetricsPanel({
  agentId,
  dashboard,
  isLoading,
  isError,
}: {
  agentId: string;
  dashboard: (EvalDashboard & { batches: EvalBatchRow[] }) | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const t = useTranslations("eval");

  if (isLoading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 24 }}>
        <Skeleton height={20} width={160} />
        <Skeleton height={90} />
      </div>
    );
  }

  if (isError) {
    return (
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 24 }}>
        {t("dashboard.loadError")}
      </p>
    );
  }

  if (!dashboard || dashboard.cases_total === 0) return null;

  const { current, delta, trend, recent_runs, batches } = dashboard;
  const tracesDelta = tracesPassedDelta(batches);

  return (
    <div style={{ marginBottom: 28 }}>
      <SectionLabel
        icon="Target"
        right={
          <Link href={`/eval/${agentId}`} style={{ fontSize: 12.5, color: "var(--accent)", whiteSpace: "nowrap" }}>
            {t("evalsTab.viewFullDashboard")}
          </Link>
        }
      >
        {t("evalsTab.metricsTitle")}
      </SectionLabel>

      <div style={{ display: "flex", gap: 12, marginBottom: 20 }}>
        <MetricCard
          label={t("dashboard.metrics.recall")}
          value={Math.round(current.recall * 100)}
          suffix="%"
          delta={delta.recall * 100}
          color="var(--accent)"
        />
        <MetricCard
          label={t("dashboard.metrics.precision")}
          value={Math.round(current.precision * 100)}
          suffix="%"
          delta={delta.precision * 100}
          color="var(--ok)"
        />
        <MetricCard
          label={t("dashboard.metrics.citationAccuracy")}
          value={Math.round(current.citation_accuracy * 100)}
          suffix="%"
          delta={delta.citation_accuracy * 100}
          color="var(--warn)"
        />
        <MetricCard
          label={t("dashboard.metrics.tracesPassed")}
          value={`${current.traces_passed}/${current.traces_total}`}
          delta={tracesDelta}
        />
      </div>

      {trend.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
            {t("dashboard.metricTrend")}
          </h4>
          <LineChart
            series={[
              { name: t("dashboard.legend.recall"), color: "var(--accent)", data: trend.map((p) => p.recall) },
              {
                name: t("dashboard.legend.precision"),
                color: "var(--ok)",
                data: trend.map((p) => p.precision),
              },
              {
                name: t("dashboard.legend.citation"),
                color: "var(--warn)",
                data: trend.map((p) => p.citation_accuracy),
              },
            ]}
          />
        </div>
      )}

      <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t("dashboard.recentRuns")}</h4>
      <RunHistoryTable runs={recent_runs} />
    </div>
  );
}

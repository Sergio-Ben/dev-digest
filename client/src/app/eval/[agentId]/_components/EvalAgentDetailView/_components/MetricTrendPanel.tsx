/* MetricTrendPanel — the "METRIC TREND" card on the per-agent detail page:
   an uppercase, icon-led title, a colour-keyed legend (Recall / Precision /
   Citation) aligned to the far right of the same header row, and the shared
   `LineChart` underneath. Split out of `EvalAgentDetailView` purely to keep
   that file's render body short — no state, no data fetching. */
import React from "react";
import { useTranslations } from "next-intl";
import { Icon, LineChart } from "@devdigest/ui";
import type { EvalTrendPoint } from "@devdigest/shared";

export function MetricTrendPanel({ trend }: { trend: EvalTrendPoint[] }) {
  const t = useTranslations("eval");

  if (trend.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Icon.TrendingUp size={14} style={{ color: "var(--text-muted)" }} aria-hidden="true" />
        <h3
          style={{
            flex: 1,
            fontSize: 12,
            fontWeight: 700,
            color: "var(--text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            margin: 0,
          }}
        >
          {t("dashboard.metricTrend")}
        </h3>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <LegendItem color="var(--accent)" label={t("dashboard.legend.recall")} />
          <LegendItem color="var(--ok)" label={t("dashboard.legend.precision")} />
          <LegendItem color="var(--warn)" label={t("dashboard.legend.citation")} />
        </div>
      </div>

      <LineChart
        series={[
          { name: t("dashboard.legend.recall"), color: "var(--accent)", data: trend.map((p) => p.recall) },
          { name: t("dashboard.legend.precision"), color: "var(--ok)", data: trend.map((p) => p.precision) },
          {
            name: t("dashboard.legend.citation"),
            color: "var(--warn)",
            data: trend.map((p) => p.citation_accuracy),
          },
        ]}
      />
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-muted)" }}>
      <span style={{ width: 12, height: 2, borderRadius: 1, background: color }} />
      {label}
    </span>
  );
}
